import { createElement as el } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

export function passportPage(passport) {
  const published = passport?.state === 'Published';
  const content = published ? [
    el('p', { key: 'batch', className: 'muted' }, `Batch ${passport.batch} · Version ${passport.version} · ${passport.published}`),
    el('h2', { key: 'profile' }, passport.profile),
    el('dl', { key: 'fields', className: 'public-fields' }, passport.fields.map(field =>
      el('div', { key: field.name }, el('dt', null, field.name), el('dd', null, field.value)))),
  ] : el('p', null, passport ? 'This passport is suspended.' : 'There is no published passport at this address.');
  return '<!doctype html>' + renderToStaticMarkup(el('html', { lang: 'en' },
    el('head', null,
      el('meta', { charSet: 'utf-8' }),
      el('meta', { name: 'viewport', content: 'width=device-width, initial-scale=1' }),
      el('title', null, 'HAPZO Digital Product Passport'),
      el('link', { rel: 'stylesheet', href: '/style.css' })),
    el('body', { className: 'public-page' }, el('article', { className: 'paper' },
      el('div', { className: 'brand' }, el('span', { className: 'mark' }, 'H'), el('span', null, 'HAPZO')),
      el('h1', null, 'Digital Product Passport'), content))));
}
