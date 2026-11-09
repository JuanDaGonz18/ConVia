// Used by review-cli.mjs: what is in review, and the approve/reject path the app reads
// (my_institution → status, method and the latest check's reasons).

// The reasons the app can show (institution.reviewReasons.*), with the policy's rule for each.
export const REJECT_REASONS = {
  unclear: 'The information is not enough to confirm it (also: the device could not use the photo).',
  mismatch: 'Names, institution or e-mail domain do not match the profile or the institution chosen.',
  not_student: 'It does not look like a card or account from this institution (expired, edited, a copy).',
};

// A check that goes to manual review keeps the images Muse read (face already cut out on the phone) at
// face-verifications/<user_id>/student-card-review-*.jpg. They are deleted on approve/reject, when a later
// check of the user's goes to review or is verified, and after 7 days (card-review-cleanup). Nothing else in the bucket is ever shown.
const REVIEW_BUCKET = 'face-verifications';
const REVIEW_PREFIX = 'student-card-review-';

export const check = ({ data, error }) => {
  if (error) throw error;
  return data;
};

export async function lastCheck(admin, userId) {
  return check(await admin.from('student_id_checks')
    .select('created_at, kind, decision, reasons, name_similarity, institution_read, email_domain, expires_on, looks_real, face_match, review_summary')
    .eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle());
}

export async function countPending(admin) {
  const { count, error } = await admin.from('institution_memberships').select('user_id', { count: 'exact', head: true }).eq('status', 'review');
  if (error) throw error;
  return count;
}

// Oldest first: the longest wait is decided first.
export async function pendingReviews(admin) {
  const rows = check(await admin.from('institution_memberships')
    .select('user_id, institution_id, updated_at, institutions(nombre), profiles(nombre, email)')
    .eq('status', 'review').order('updated_at'));
  return Promise.all(rows.map(async (row) => ({ ...row, last: await lastCheck(admin, row.user_id) })));
}

async function reviewFiles(admin, userId) {
  const files = check(await admin.storage.from(REVIEW_BUCKET).list(userId, { search: REVIEW_PREFIX, limit: 20 }));
  return files.filter((f) => f.id && f.name.startsWith(REVIEW_PREFIX)).map((f) => `${userId}/${f.name}`);
}

// Links that work for `seconds` (5 minutes by default).
export async function signedFiles(admin, userId, seconds = 300) {
  const urls = [];
  for (const path of await reviewFiles(admin, userId)) {
    const signed = check(await admin.storage.from(REVIEW_BUCKET).createSignedUrl(path, seconds));
    urls.push({ bucket: REVIEW_BUCKET, name: path.slice(userId.length + 1), url: signed.signedUrl });
  }
  return urls;
}

export async function removeReviewFiles(admin, userId) {
  const paths = await reviewFiles(admin, userId);
  if (paths.length) check(await admin.storage.from(REVIEW_BUCKET).remove(paths));
  return paths.length;
}

async function reviewMembership(admin, userId) {
  const membership = check(await admin.from('institution_memberships').select('status, institution_id').eq('user_id', userId).maybeSingle());
  if (!membership) throw new Error('No membership for that user.');
  if (membership.status !== 'review') throw new Error(`That membership is "${membership.status}", not in review.`);
  return membership;
}

// Method "document" for the card-without-photo path, otherwise "student_card_photo".
export async function approveMethod(admin, userId) {
  const last = await lastCheck(admin, userId);
  return last?.kind === 'document' ? 'document' : 'student_card_photo';
}

export async function approve(admin, userId) {
  await reviewMembership(admin, userId);
  const method = await approveMethod(admin, userId);
  check(await admin.rpc('service_set_membership_status', { p_user: userId, p_status: 'verified', p_method: method }));
  await removeReviewFiles(admin, userId);
  return method;
}

// Back to "pending"; the app shows the latest check: a "retry" with the reviewer's reason.
export async function reject(admin, userId, reason) {
  if (!(reason in REJECT_REASONS)) throw new Error(`Reason must be one of: ${Object.keys(REJECT_REASONS).join(', ')}`);
  const membership = await reviewMembership(admin, userId);
  const last = await lastCheck(admin, userId);
  check(await admin.rpc('service_set_membership_status', { p_user: userId, p_status: 'pending' }));
  check(await admin.from('student_id_checks').insert({ user_id: userId, institution_id: membership.institution_id, decision: 'retry', kind: last?.kind ?? 'card_photo', reasons: ['review_rejected', `review_${reason}`] }));
  await removeReviewFiles(admin, userId);
}
