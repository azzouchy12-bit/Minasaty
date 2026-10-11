"use strict";

/**
 * Calculates remaining days and expiry flags for a subscription end date.
 * Returns null if no date is provided or date is invalid.
 */
function getSubscriptionDaysRemaining(endDateValue) {
  if (!endDateValue) return null;
  const end = new Date(endDateValue);
  if (Number.isNaN(end.getTime())) return null;

  const now = new Date();
  const endCalendar = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  const nowCalendar = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const diffMs = endCalendar.getTime() - nowCalendar.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  return {
    diffDays,
    isExpired: diffDays < 0,
    isToday: diffDays === 0,
    isDueSoon: diffDays <= 5,
    end,
  };
}

/**
 * Returns true if the student subscription has expired.
 */
function isStudentSubscriptionExpired(student) {
  if (!student) return false;
  if (student.paymentStage === "EXPIRED") return true;
  if (!student.subscriptionEndDate) return false;
  const validity = getSubscriptionDaysRemaining(student.subscriptionEndDate);
  return Boolean(validity && validity.isExpired);
}

/**
 * Returns true if the student is eligible to renew their subscription
 * (i.e. already expired or due for renewal within 5 days).
 */
function isStudentEligibleForRenewal(student) {
  if (!student) return false;
  if (student.paymentStage === "EXPIRED") return true;
  if (!student.subscriptionEndDate) return false;
  const validity = getSubscriptionDaysRemaining(student.subscriptionEndDate);
  return Boolean(validity && (validity.isExpired || validity.isDueSoon));
}

/**
 * Safe 1-month date increment avoiding JS month rollover issues (e.g. Jan 31 -> Feb 28).
 */
function addOneMonth(baseDate) {
  const result = new Date(baseDate.getTime());
  const currentDay = result.getDate();
  result.setMonth(result.getMonth() + 1);
  if (result.getDate() !== currentDay) {
    result.setDate(0);
  }
  return result;
}

/**
 * Calculates renewed subscription start and end dates.
 * If currently valid and not expired, extends the current end date by 1 month.
 * If expired (or unset), starts from now and sets end date to 1 month from now.
 */
function calculateRenewedSubscriptionDates(currentStartDate, currentEndDate) {
  const now = new Date();
  let newStartDate = now;
  let newEndDate = addOneMonth(now);

  if (currentEndDate) {
    const end = new Date(currentEndDate);
    if (!Number.isNaN(end.getTime())) {
      const endCalendar = new Date(end.getFullYear(), end.getMonth(), end.getDate());
      const nowCalendar = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      if (endCalendar.getTime() >= nowCalendar.getTime()) {
        // Active subscription: preserve start date and extend end date by 1 month
        const validStart = currentStartDate ? new Date(currentStartDate) : now;
        newStartDate = Number.isNaN(validStart.getTime()) ? now : validStart;
        newEndDate = addOneMonth(end);
        return {
          subscriptionStartDate: newStartDate,
          subscriptionEndDate: newEndDate,
        };
      }
    }
  }

  return {
    subscriptionStartDate: newStartDate,
    subscriptionEndDate: newEndDate,
  };
}

module.exports = {
  getSubscriptionDaysRemaining,
  isStudentSubscriptionExpired,
  isStudentEligibleForRenewal,
  calculateRenewedSubscriptionDates,
  addOneMonth,
};
