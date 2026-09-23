/**
 * Per-attempt result visibility.
 * Once teacher announces, only attempts submitted at or before resultsReleasedAt
 * can see scores. Later attempts stay held until the next announce.
 */

function isAttemptAnnounced(exam, attempt) {
  if (!attempt || attempt.status !== 'submitted') return false;
  if (!exam?.resultsReleased) return false;

  // Legacy docs released without a timestamp: treat all submitted as visible.
  if (!exam.resultsReleasedAt || !attempt.submittedAt) {
    return true;
  }

  return new Date(attempt.submittedAt).getTime() <= new Date(exam.resultsReleasedAt).getTime();
}

export function areAttemptResultsVisible(exam, attempt) {
  if (attempt?.resultsHidden) return false;
  return isAttemptAnnounced(exam, attempt);
}

export function isAttemptPendingRelease(exam, attempt) {
  if (!attempt || attempt.status !== 'submitted') return false;
  return !isAttemptAnnounced(exam, attempt);
}

export function countPendingReleaseAttempts(exam, attempts = []) {
  return attempts.filter((attempt) => isAttemptPendingRelease(exam, attempt)).length;
}

export function pendingReleaseAttempts(exam, attempts = []) {
  return attempts.filter((attempt) => isAttemptPendingRelease(exam, attempt));
}
