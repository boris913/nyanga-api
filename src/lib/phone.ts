// Numéros camerounais : 9 chiffres commençant par 6 (mobile) ou 2 (fixe), indicatif +237.
export function normalizeCameroonPhone(input: string): string | null {
  const digits = input.replace(/[\s().-]/g, '').replace(/^\+/, '').replace(/^00/, '');
  const local = digits.startsWith('237') ? digits.slice(3) : digits;
  if (!/^[62]\d{8}$/.test(local)) return null;
  return `+237${local}`;
}

// Numéro WhatsApp : mobile camerounais uniquement (9 chiffres commençant par 6).
export function normalizeWhatsapp(input: string): string | null {
  const phone = normalizeCameroonPhone(input);
  return phone && phone.startsWith('+2376') ? phone : null;
}

// Seul le premier chiffre reste visible : « +237 6XX XX XX XX ».
export function maskWhatsapp(phone: string): string {
  return `+237 ${phone.charAt(4)}XX XX XX XX`;
}

export function whatsappLink(phone: string, text: string): string {
  return `https://wa.me/${phone.slice(1)}?text=${encodeURIComponent(text)}`;
}
