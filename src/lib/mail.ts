import type { FastifyBaseLogger } from 'fastify';

export type Mail = { to: string; subject: string; text: string };

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

// Pilote de développement : l'email apparaît dans les logs de l'API.
// En production, brancher un fournisseur (Amazon SES, Resend, Brevo...) derrière la même interface.
// "none" : aucun envoi (MVP) ; les routes qui en dépendent répondent 503.
export function createMailer(driver: string, log: FastifyBaseLogger): Mailer {
  if (driver === 'none') {
    return {
      async send() {
        throw new Error('Envoi d’emails désactivé (MAIL_DRIVER=none)');
      },
    };
  }
  if (driver === 'console') {
    return {
      async send(mail) {
        log.warn(mail, 'Email (pilote console, ne pas utiliser en production)');
      },
    };
  }
  throw new Error(`Pilote email inconnu : ${driver}`);
}
