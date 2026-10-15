// Numéros camerounais : 9 chiffres commençant par 6 (mobile) ou 2 (fixe), indicatif +237.
export function normalizeCameroonPhone(input: string): string | null {
  const digits = input.replace(/[\s().-]/g, '').replace(/^\+/, '').replace(/^00/, '');
  const local = digits.startsWith('237') ? digits.slice(3) : digits;
  if (!/^[62]\d{8}$/.test(local)) return null;
  return `+237${local}`;
}
