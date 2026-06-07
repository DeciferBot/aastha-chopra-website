/**
 * Test: find trending UAE creators via IG Graph API hashtag search
 * Usage: node scripts/test-hashtag-creators.mjs <ACCESS_TOKEN> [<IG_USER_ID>]
 *
 * IG_USER_ID is the numeric ID of Aastha's IG business account.
 * If omitted, the script fetches it from /me.
 */

const [,, TOKEN, USER_ID_ARG] = process.argv;

if (!TOKEN) {
  console.error('Usage: node scripts/test-hashtag-creators.mjs <ACCESS_TOKEN>');
  process.exit(1);
}

const BASE = 'https://graph.instagram.com/v21.0';

async function ig(path) {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`${BASE}${path}${sep}access_token=${TOKEN}`);
  const data = await res.json();
  if (data.error) throw new Error(`IG: ${data.error.message} (${path})`);
  return data;
}

// Hashtags to probe — UAE fashion/lifestyle signals
const HASHTAGS = [
  'dubaifashion',
  'dubaistyleblogger',
  'uaefashion',
  'dubaiinfluencer',
  'dubailuxury',
  'emiratifashion',
];

async function getHashtagId(tag, userId) {
  const r = await ig(`/ig_hashtag_search?user_id=${userId}&q=${tag}`);
  return r.data?.[0]?.id;
}

async function getTopMedia(hashtagId, userId) {
  // top_media returns the ~9 highest-engagement posts using this hashtag right now
  const r = await ig(`/${hashtagId}/top_media?user_id=${userId}&fields=id,media_type,timestamp,like_count,comments_count,permalink`);
  return r.data || [];
}

async function getOwnerUsername(mediaId) {
  try {
    // owner field only available on public media in some cases
    const r = await ig(`/${mediaId}?fields=username,owner`);
    return r.username || r.owner?.username || null;
  } catch {
    return null;
  }
}

async function main() {
  // Step 1: get Aastha's IG user ID (needed for hashtag search)
  let userId = USER_ID_ARG;
  if (!userId) {
    console.log('Fetching IG user ID...');
    const me = await ig('/me?fields=id,username');
    userId = me.id;
    console.log(`Account: @${me.username} (${userId})\n`);
  }

  const results = [];

  for (const tag of HASHTAGS) {
    process.stdout.write(`#${tag} — `);
    try {
      const hashtagId = await getHashtagId(tag, userId);
      if (!hashtagId) { console.log('no hashtag ID returned'); continue; }

      const media = await getTopMedia(hashtagId, userId);
      console.log(`${media.length} top posts`);

      for (const post of media) {
        // Try to get username — this often fails on the business API
        // but worth seeing what we get
        const username = await getOwnerUsername(post.id);
        results.push({
          hashtag: tag,
          media_id: post.id,
          username: username || '(not accessible)',
          media_type: post.media_type,
          likes: post.like_count ?? '?',
          comments: post.comments_count ?? '?',
          timestamp: post.timestamp,
          permalink: post.permalink || '(private)',
        });
      }

      // Rate limit: IG allows 30 hashtag searches per hour per user
      await new Promise(r => setTimeout(r, 500));

    } catch (e) {
      console.log(`ERROR: ${e.message}`);
    }
  }

  console.log('\n========== RESULTS ==========\n');

  // Group by hashtag
  for (const tag of HASHTAGS) {
    const tagResults = results.filter(r => r.hashtag === tag);
    if (!tagResults.length) continue;
    console.log(`\n#${tag} (${tagResults.length} posts):`);
    tagResults.forEach(r => {
      console.log(`  ${r.username.padEnd(30)} ${r.media_type.padEnd(15)} ❤️ ${String(r.likes).padEnd(6)} 💬 ${r.comments}  ${r.permalink}`);
    });
  }

  // Summary: unique creators
  const creators = [...new Set(results.map(r => r.username).filter(u => u !== '(not accessible)'))];
  console.log(`\n\n========== UNIQUE CREATORS ==========`);
  console.log(`Total: ${creators.length}`);
  creators.forEach(c => console.log(`  @${c}`));

  // Show how many posts had accessible usernames vs not
  const accessible = results.filter(r => r.username !== '(not accessible)').length;
  console.log(`\nUsername accessible: ${accessible}/${results.length} posts`);
  console.log('\nDone.');
}

main().catch(e => { console.error(e.message); process.exit(1); });
