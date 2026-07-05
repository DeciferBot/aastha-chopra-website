/**
 * Promote-existing-post brain — single source of truth for turning an organic
 * Instagram post/reel into an ad WITHOUT re-uploading its media.
 *
 * Why this exists:
 *   The old ad crons stripped each reel's video (or a post's image) and built a
 *   FRESH creative from it. Meta treats that as a brand-new "dark post" with its
 *   own object id, so every like/comment/view the ad earns lands on that hidden
 *   object and NEVER on the real post. We were paying to build social proof that
 *   nobody could see, and the organic post got nothing.
 *
 *   The correct path (Meta "Use Posts as Instagram Ads") is to reference the
 *   EXISTING post by id. All paid engagement then consolidates onto the real
 *   post. The ad creative uses three top-level fields — object_id (Page),
 *   instagram_user_id, source_instagram_media_id — and NOT object_story_spec
 *   (that's the Facebook-post path).
 *   https://developers.facebook.com/docs/instagram/ads-api/guides/use-posts-as-ads/
 *
 * The one namespace trap this module guards against:
 *   `source_instagram_media_id` must be the media id from the Instagram *Graph*
 *   API user-media edge (graph.facebook.com/<IG_USER_ID>/media, read with the
 *   ads token). That is a different id space from graph.instagram.com/me/media
 *   (the IG-Login token the website sync uses). So we resolve media ids here,
 *   through the ads token, to guarantee they match what the creative expects.
 *
 * Everything here uses META_ADS_ACCESS_TOKEN against the FB Graph API.
 */

const FB_BASE = 'https://graph.facebook.com/v21.0';

function adsToken() {
  const t = process.env.META_ADS_ACCESS_TOKEN;
  if (!t) throw new Error('Missing META_ADS_ACCESS_TOKEN');
  return t;
}

async function fbGet(path) {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`${FB_BASE}${path}${sep}access_token=${adsToken()}`);
  const data = await res.json();
  if (data.error) throw new Error(`FB GET ${path}: ${data.error.message}`);
  return data;
}

/** Extract the shortcode from an IG permalink (/reel/CODE/, /p/CODE/, /tv/CODE/). */
export function shortcodeOf(permalink) {
  const m = (permalink || '').match(/\/(?:reel|p|tv)\/([^/]+)/);
  return m ? m[1] : null;
}

/**
 * The IG business account linked to the Page — the identity the ad publishes as
 * and the owner of the media we promote. Resolving this from the Page (rather
 * than a hardcoded id) is what stops the old "wrong IG id was rejected" failure.
 * @param {string} pageId
 * @param {string} [fallback] used only if the Page exposes no linked IG account
 * @returns {Promise<string>} IG user id
 */
export async function resolveIgUserId(pageId, fallback) {
  const p = await fbGet(
    `/${pageId}?fields=instagram_business_account{id,username},connected_instagram_account{id,username}`
  );
  const id = p.instagram_business_account?.id || p.connected_instagram_account?.id || fallback;
  if (!id) throw new Error(`No Instagram account is linked to Page ${pageId}`);
  return id;
}

/**
 * Fetch the IG account's recent media (through the ads token, so the ids are in
 * the source_instagram_media_id namespace) and index it by shortcode.
 * @param {string} igUserId
 * @param {number} [max] how many recent media to page through (default 500)
 * @returns {Promise<{list: object[], byCode: Record<string, object>}>}
 */
export async function fetchIgMediaMap(igUserId, max = 500) {
  const token = adsToken();
  let media = [];
  let url = `${FB_BASE}/${igUserId}/media?fields=id,media_type,permalink,caption,thumbnail_url&limit=100&access_token=${token}`;
  while (url && media.length < max) {
    const res = await fetch(url);
    const data = await res.json();
    if (data.error) throw new Error(`IG Graph media: ${data.error.message}`);
    media = media.concat(data.data || []);
    url = data.paging?.next || null;
  }
  const byCode = {};
  for (const m of media) {
    const code = shortcodeOf(m.permalink);
    if (code && !byCode[code]) byCode[code] = m;
  }
  return { list: media, byCode };
}

/**
 * Resolve a single post shortcode → its media object (with the correct id).
 * @param {string} igUserId
 * @param {string} shortcode
 * @returns {Promise<object>} media { id, media_type, permalink, caption, thumbnail_url }
 */
export async function resolveMediaByShortcode(igUserId, shortcode) {
  const { byCode } = await fetchIgMediaMap(igUserId);
  const m = byCode[shortcode];
  if (!m) {
    throw new Error(
      `Post ${shortcode} not found in the IG account's latest 500 media. ` +
      `If it's older than that, widen the lookback; if this looks wrong, the ads ` +
      `token may lack instagram_basic for this account.`
    );
  }
  return m;
}

/**
 * Build the ad-creative body that promotes an EXISTING IG post. POST this to
 * /act_<AD_ACCOUNT>/adcreatives with the caller's own fbPost so engagement lands
 * on the real post. Deliberately NO object_story_spec / video_data / image_hash.
 * @returns {{name: string, object_id: string, instagram_user_id: string, source_instagram_media_id: string}}
 */
export function existingPostCreativeBody({ name, pageId, igUserId, mediaId }) {
  if (!pageId || !igUserId || !mediaId) {
    throw new Error('existingPostCreativeBody needs pageId, igUserId and mediaId');
  }
  return {
    name,
    object_id: pageId,               // the Page identity
    instagram_user_id: igUserId,     // the IG account that owns the media
    source_instagram_media_id: mediaId, // the real organic post — engagement stays here
  };
}
