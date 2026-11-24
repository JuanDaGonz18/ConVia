import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { escapeHtml, fechaEs, firstName, renderEmail } from './emails.ts';

const base = { email: 'ana@unisabana.edu.co', nombre: 'Ana María Pérez', plusUntil: null, promo: false, months: null };

describe('emails', () => {
  it('formats dates in Bogotá time', () => {
    assert.equal(fechaEs('2027-02-15T04:59:00Z'), '14 de febrero de 2027');
    assert.equal(fechaEs('2027-02-15T05:00:00Z'), '15 de febrero de 2027');
  });

  it('uses only a usable first name', () => {
    assert.equal(firstName('Ana María Pérez'), 'Ana');
    assert.equal(firstName('  '), null);
    assert.equal(firstName(null), null);
  });

  it('welcome: thanks, tips and the button to the app', () => {
    const mail = renderEmail({ ...base, kind: 'welcome' });
    assert.match(mail.subject, /^Ana, te damos la bienvenida/);
    assert.match(mail.html, /Gracias por confiar/);
    assert.match(mail.html, /Guarda tus lugares/);
    assert.match(mail.html, /href="https:\/\/juandagonz18\.github\.io\/ConVia\/app\/"/);
    assert.doesNotMatch(mail.html, /de regalo/);
    assert.match(mail.text, /1\. Verifica tu institución/);
  });

  it('welcome: mentions the launch gift with its end date', () => {
    const mail = renderEmail({ ...base, kind: 'welcome', promo: true, plusUntil: '2027-01-24T21:00:00Z' });
    assert.match(mail.html, /ConVía\+ de regalo hasta el 24 de enero de 2027/);
  });

  it('plus_first: thanks for the first payment with period and end date', () => {
    const mail = renderEmail({ ...base, kind: 'plus_first', months: 12, plusUntil: '2027-11-30T15:00:00Z' });
    assert.equal(mail.subject, '¡Gracias por pasarte a ConVía+!');
    assert.match(mail.html, /pago de 12 meses/);
    assert.match(mail.html, /30 de noviembre de 2027/);
    assert.match(mail.html, /No se renueva solo/);
  });

  it('escapes the name (it comes from the user)', () => {
    const mail = renderEmail({ ...base, kind: 'welcome', nombre: '<img src=x>' });
    assert.doesNotMatch(mail.html, /<img src=x>/);
    assert.equal(escapeHtml('<a>'), '&lt;a&gt;');
  });
});
