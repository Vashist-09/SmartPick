export const demoParcels = {
  SP1024: { slot: 'A-04', carrier: 'Blue Dart', arrived: 'Today, 10:42 AM' },
  SP2048: { slot: 'B-12', carrier: 'Delhivery', arrived: 'Today, 9:18 AM' },
  SP4096: { slot: 'C-02', carrier: 'Amazon Shipping', arrived: 'Yesterday, 4:30 PM' }
};
export function lookupParcel(value) {
  const id = value.trim().toUpperCase();
  if (!id) throw new Error('Enter your registration number, or choose a demo ID below.');
  if (id.length < 3 || id.length > 30) throw new Error('Use 3–30 characters for the registration number.');
  if (!/^[A-Z0-9-]+$/.test(id)) throw new Error('Use letters, numbers or hyphens only. Remove spaces and special characters.');
  return { id, ...(demoParcels[id] || {}), status: demoParcels[id] ? 'FOUND' : 'NOT_FOUND' };
}

// Demo form validation only. These helpers do not authenticate a user.
export function validateIdentity(value) {
  const text = String(value || '').trim();
  if (!text) return 'Enter your email or student ID.';
  if (text.includes('@')) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? '' : 'Enter a valid email address.';
  return /^[a-z0-9-]{3,30}$/i.test(text) ? '' : 'Use 3–30 letters, numbers or hyphens for your student ID.';
}
export function validateProfile(values) {
  const errors = {};
  values = Object.fromEntries(['fullName','registration','email','phone'].map(key => [key, typeof values?.[key] === 'string' ? values[key] : '']));
  if (!values.fullName?.trim() || values.fullName.trim().length < 2) errors.fullName = 'Enter your full name (at least 2 characters).';
  else if (values.fullName.trim().length > 80) errors.fullName = 'Keep your name to 80 characters or fewer.';
  if (!/^[a-z0-9-]{3,30}$/i.test(values.registration?.trim() || '')) errors.registration = 'Use 3–30 letters, numbers or hyphens for your VIT registration number.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email?.trim() || '')) errors.email = 'Enter a valid email address.';
  if (values.phone?.trim() && (!/^[+\d\s()-]+$/.test(values.phone) || !/^\d{7,15}$/.test(values.phone.replace(/\D/g, '')))) errors.phone = 'Enter a phone number with 7–15 digits, or leave it blank.';
  return errors;
}
export function validateAccountForm(mode, values) {
  if (mode === 'profile') return validateProfile(values);
  const errors = mode === 'register' ? validateProfile(values) : {};
  if (mode !== 'register') { const error = validateIdentity(values.identity); if (error) errors.identity = error; }
  if (mode === 'forgot') return errors;
  if (!values.password || values.password.length < 8) errors.password = 'Enter at least 8 characters for the demo password field.';
  if (mode === 'register' && values.confirmPassword !== values.password) errors.confirmPassword = 'The passwords do not match.';
  return errors;
}
export function cleanProfile(values) {
  return {
    fullName: values.fullName.trim(), registration: values.registration.trim().toUpperCase(),
    email: values.email.trim().toLowerCase(), phone: (values.phone || '').trim()
  };
}
export function initials(name) {
  return String(name || 'Student').trim().split(/\s+/).filter(Boolean).slice(0,2).map(part => [...part][0]).join('').toUpperCase();
}
