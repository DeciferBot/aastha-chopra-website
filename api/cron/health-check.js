/**
 * Morning health check — Vercel Cron.
 *
 * Every automated job here already records why it failed. Nothing read those
 * records, so failures accumulated in silence: the blog agent failed 13 of its
 * last 16 runs on an empty API balance for three weeks, the ad autopilot errored
 * on 3 of 4 runs, 83 brand pitches sat queued behind an approval nobody gave,
 * and AED 1,450 of ad spend ran for weeks while followers fell. Each of those
 * was visible in the database the day it started.
 *
 * This reads the tables the other crons write and emails when something needs a
 * human. It makes no decisions and changes no state.
 *
 * Silent when everything is healthy — an alert that fires daily gets muted, and
 * a muted alert is the problem it was built to solve.
 *
 * GET /api/cron/health-check   Auth: Bearer CRON_SECRET | MANUAL_SYNC_KEY
 */

const SUPABASE_URL = 'https://uqzvaytvynrglijvwjsz.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const RESEND_KEY   = process.env.RESEND_API_KEY;
// Operational alerts go to whoever runs the system, not to Aastha. Overridable
// without a deploy, but defaulted so a missing env var can't silence the alarm.
const ALERT_EMAIL  = process.env.ALERT_EMAIL || 'chopraa@gmail.com';
const ALERT_FROM   = 'Site Monitor <hello@aasthachopra.com>';

// How far back each check looks.
const FAILURE_LOOKBACK_DAYS = 3;   // job failures worth waking someone for
const FOLLOWER_WINDOW_DAYS  = 7;   // growth is noisy day to day; a week is a trend
const QUEUE_STALE_DAYS      = 3;   // a pitch waiting this long is stuck, not pending
const BLOG_STALE_DAYS       = 10;  // publishes Mon and Thu, so 10 quiet days means stuck
const BLOG_REJECT_WINDOW_DAYS = 14; // window for "is everything being rejected?"

async function sb(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!res.ok) throw new Error(`Supabase ${path}: ${await res.text()}`);
  return res.json();
}

/** Returns the Resend id on success; throws so a silent send failure can't pass as healthy. */
async function sendAlert(subject, text) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_KEY}` },
    body: JSON.stringify({ from: ALERT_FROM, to: ALERT_EMAIL, subject, text }),
  });
  if (!res.ok) throw new Error(`Resend: ${await res.text()}`);
  const body = await res.json().catch(() => ({}));
  return body.id || 'sent';
}

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
const dayOnly = (n) => daysAgo(n).slice(0, 10);

/**
 * First readable line out of an errors column. The shape varies by table —
 * jsonb array, text[], or a bare string — and the payloads are often a whole
 * API error blob, so this trims to something that fits in a phone notification.
 */
function firstError(errors) {
  const raw = Array.isArray(errors) ? errors[0] : errors;
  if (!raw) return 'no detail recorded';
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
  // Surface the human-readable message when the payload is a nested API error.
  // Quoting varies by source: the blog agent logs real JSON, the UAE agent logs
  // a Python dict repr, so match either quote style rather than only JSON.
  const message = text.match(/["']message["']\s*:\s*["']([^"']{5,160})["']/);
  const clean = (message ? message[1] : text).replace(/\s+/g, ' ').trim();
  return clean.length > 120 ? `${clean.slice(0, 117)}…` : clean;
}

export default async function handler(req, res) {
  const auth = req.headers.authorization;
  const allowed = auth === `Bearer ${process.env.CRON_SECRET}`
    || (!!process.env.MANUAL_SYNC_KEY && auth === `Bearer ${process.env.MANUAL_SYNC_KEY}`);
  if (!allowed) return res.status(401).end();

  const since = daysAgo(FAILURE_LOOKBACK_DAYS);
  const broken = [];   // needs a human today
  const watch  = [];   // worth a look, not yet on fire
  const checks = {};

  // Each check is independent: one unavailable table must not blind the others,
  // so a thrown query is reported rather than aborting the whole run.
  const guard = async (name, fn) => {
    try { await fn(); checks[name] = 'ok'; }
    catch (e) { checks[name] = `check failed: ${e.message}`; watch.push(`⚠️ Health check "${name}" could not run: ${e.message}`); }
  };

  // ── 1. Scheduled jobs that failed ──────────────────────────────────────────
  await guard('job_failures', async () => {
    const [blog, uae, autopilot] = await Promise.all([
      sb(`/blog_agent_runs?ran_at=gte.${since}&status=eq.failed&select=ran_at,segment,errors&order=ran_at.desc`),
      sb(`/uae_agent_runs?ran_at=gte.${since}&status=eq.failed&select=ran_at,errors&order=ran_at.desc`),
      sb(`/ad_autopilot_runs?ran_at=gte.${since}&status=eq.error&select=ran_at,detail&order=ran_at.desc`),
    ]);
    if (blog.length) broken.push(`🔴 Blog writer failed ${blog.length}× in ${FAILURE_LOOKBACK_DAYS} days\n   ${firstError(blog[0].errors)}`);
    if (uae.length) broken.push(`🔴 UAE agent failed ${uae.length}× in ${FAILURE_LOOKBACK_DAYS} days\n   ${firstError(uae[0].errors)}`);
    if (autopilot.length) broken.push(`🔴 Ad autopilot errored ${autopilot.length}× in ${FAILURE_LOOKBACK_DAYS} days\n   ${firstError(autopilot[0].detail)}`);
  });

  // ── 2. Instagram data going stale (ig-sync runs every 4 hours) ─────────────
  await guard('data_freshness', async () => {
    const [latest] = await sb('/instagram_snapshots?select=snapshot_date&order=snapshot_date.desc&limit=1');
    if (!latest) return broken.push('🔴 No Instagram snapshots at all — ig-sync has never written');
    if (latest.snapshot_date < dayOnly(2)) {
      broken.push(`🔴 Instagram data is stale — newest is ${latest.snapshot_date}. ig-sync is not running.`);
    }
  });

  // ── 3 & 4. Followers, and whether spend is buying any ──────────────────────
  // Read together: "followers fell" and "followers fell while we paid" are the
  // same fact at two severities, and only the second is urgent.
  await guard('follower_growth', async () => {
    const rows = await sb(`/instagram_daily_metrics?select=metric_date,follower_count&order=metric_date.desc&limit=${FOLLOWER_WINDOW_DAYS + 1}`);
    const points = rows.filter((r) => typeof r.follower_count === 'number');
    if (points.length < 2) return;

    const newest = points[0];
    const oldest = points[points.length - 1];
    const net = newest.follower_count - oldest.follower_count;

    // spend_aed is a running total for the campaigns still on the books, not a
    // per-day figure — it decays toward zero as campaigns are paused. Summing a
    // week of it overstates spend roughly sevenfold, so read the latest value
    // and treat it as "money currently running", which is the actual question.
    const [scoreboard] = await sb('/ads_scoreboard_daily?select=date,spend_aed&order=date.desc&limit=1');
    const spend = Number(scoreboard?.spend_aed) || 0;

    if (spend > 0 && net <= 0) {
      broken.push(`🔴 Spending with nothing to show: AED ${spend.toFixed(2)} on the books, followers ${net >= 0 ? '+' : ''}${net} over ${FOLLOWER_WINDOW_DAYS} days\n   Stop the campaigns or change the creative.`);
    } else if (net < 0) {
      watch.push(`🟡 Followers down ${Math.abs(net)} over ${FOLLOWER_WINDOW_DAYS} days (no ad spend) — now ${newest.follower_count.toLocaleString()}`);
    }
  });

  // ── 5. Brand pitches stuck behind approval ────────────────────────────────
  await guard('outreach_queue', async () => {
    const queued = await sb('/outreach_pipeline?status=eq.queued&select=created_at&order=created_at.asc');
    if (!queued.length) return;
    const oldest = queued[0].created_at || '';
    if (oldest && oldest < daysAgo(QUEUE_STALE_DAYS)) {
      broken.push(`🔴 ${queued.length} brand pitch${queued.length === 1 ? '' : 'es'} queued and unsent — oldest waiting since ${oldest.slice(0, 10)}\n   Nothing is going out until these are approved.`);
    }
  });

  // ── 6. The Journal pipeline ───────────────────────────────────────────────
  // The generator auto-publishes, but only what passes the quality gates
  // (api/_blog-qa.js). So there is nothing to approve. The two things worth
  // knowing are: has it silently stopped publishing, and is it writing pieces
  // that keep getting rejected? Both mean the pipeline needs a look, not a tap.
  await guard('blog_publishing', async () => {
    const [latest] = await sb('/blog_posts?status=eq.published&select=slug,published_at&order=published_at.desc.nullslast&limit=1');
    if (latest?.published_at && latest.published_at < daysAgo(BLOG_STALE_DAYS)) {
      watch.push(`🟡 Nothing new on the Journal since ${latest.published_at.slice(0, 10)}. The writer may be failing every quality gate.`);
    }

    const runs = await sb(`/blog_agent_runs?ran_at=gte.${daysAgo(BLOG_REJECT_WINDOW_DAYS)}&select=ran_at,status,segment,errors&order=ran_at.desc&limit=20`);
    const decided = runs.filter((r) => r.status === 'success' || r.status === 'rejected');
    const rejected = decided.filter((r) => r.status === 'rejected');
    // Some rejection is the gates doing their job. Everything rejected means the
    // writer and the gates disagree, and no amount of waiting will fix it.
    if (decided.length >= 3 && rejected.length === decided.length) {
      watch.push(
        `🟡 The Journal writer has been rejected on its last ${decided.length} runs, so nothing has published.\n`
        + `   Most recent reason: ${firstError(rejected[0].errors)}`
      );
    }

    const stuck = await sb('/blog_posts?status=eq.needs_work&select=slug&limit=25');
    if (stuck.length >= 8) {
      watch.push(`🟡 ${stuck.length} Journal pieces are sitting in needs_work. Worth reading a couple to see what the gates keep catching.`);
    }
  });

  // Silence is the feature. Report the all-clear to the caller, not to the inbox.
  if (!broken.length && !watch.length) {
    return res.status(200).json({ ok: true, healthy: true, alerted: false, checks });
  }

  const headline = broken.length
    ? `${broken.length} thing${broken.length === 1 ? '' : 's'} need${broken.length === 1 ? 's' : ''} you today`
    : `Nothing broken — ${watch.length} to keep an eye on`;

  // The subject is the whole message on a phone lock screen, so it carries the
  // count and the first problem rather than a fixed string.
  const lead = (broken[0] || watch[0] || '').split('\n')[0].replace(/^[^\w]+\s*/, '');
  const subject = `${broken.length ? '⚠️' : 'ℹ️'} ${headline}: ${lead}`.slice(0, 140);

  const text = [
    headline,
    '',
    ...broken,
    ...(broken.length && watch.length ? [''] : []),
    ...watch,
    '',
    '—',
    'Daily check of aasthachopra.com automation. You only get this when something is wrong.',
  ].join('\n');

  const emailId = await sendAlert(subject, text);

  res.status(200).json({
    ok: true, healthy: false, alerted: ALERT_EMAIL, email_id: emailId,
    broken: broken.length, watch: watch.length, checks,
  });
}
