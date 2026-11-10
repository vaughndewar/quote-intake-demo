// Quote request reader for the quote intake demo.
// Plain rules, no AI model: it finds a customer, items, quantities, a needed-by date, a PO
// and a ship-to in free text, checks them against a small catalogue, and decides whether
// the request is ready to quote, needs a follow-up, or needs a person to look at it.
// Runs in the browser and in Node (see test.mjs), so what the page measures is what it runs.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QuoteReader = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  var MON_RE = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]{0,6}';
  var NUMBER_WORD = /\b(one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|dozen|couple|few|several)\b/i;

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }
  function parseISO(s) { var p = s.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); }
  function addDays(isoDate, n) { var d = parseISO(isoDate); d.setUTCDate(d.getUTCDate() + n); return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s; }

  // Month and day with no year: this year, or next year if that date has already passed.
  function resolve(month, day, today) {
    var y = +today.slice(0, 4);
    var cand = iso(y, month, day);
    if (cand < today) cand = iso(y + 1, month, day);
    return cand;
  }

  function parseQty(raw) {
    var s = raw.trim().toLowerCase().replace(/,/g, '');
    var mult = 1;
    if (/k$/.test(s)) { mult = 1000; s = s.slice(0, -1); }
    var n = parseFloat(s);
    return isFinite(n) ? Math.round(n * mult) : null;
  }

  function findItems(text, flags) {
    var items = [], seen = {};
    var re = /\b([A-Za-z]{3})[-\u2010](\d{3})\b/g, m; // a hyphen is required, so "and 150" is not a code
    while ((m = re.exec(text))) {
      var sku = (m[1] + '-' + m[2]).toUpperCase();
      if (seen[sku]) continue;
      seen[sku] = true;
      var start = m.index, end = m.index + m[0].length, qty = null;

      // Quantity just before the code: "250 x BRK-200", "250 pcs of BRK-200", "20 units shd-330".
      var before = text.slice(Math.max(0, start - 28), start);
      var b = before.match(/(\d[\d,]*(?:\.\d+)?\s?[kK]?)\s*(?:x|×|pcs|pieces|units|ea|each)?\s*(?:of\s+)?$/i);
      if (b && !/[-\/]\d*$/.test(before.slice(0, before.length - b[0].length))) qty = parseQty(b[1]);

      // Otherwise just after: "BRK-200 x 250", "BRK-200 - 250 units".
      if (qty === null) {
        var after = text.slice(end, end + 18);
        var a = after.match(/^\s*(?:x|×|-|:)\s*(\d[\d,]*(?:\.\d+)?\s?[kK]?)(?![\d\/-])/i);
        if (a) qty = parseQty(a[1]);
      }

      if (qty === null) {
        var near = text.slice(Math.max(0, start - 28), end + 18);
        if (NUMBER_WORD.test(near)) flags.push('quantity_in_words:' + sku);
      } else if (qty > 100000 || qty <= 0) {
        flags.push('odd_quantity:' + sku);
      }
      items.push({ sku: sku, qty: qty });
    }
    return items;
  }

  function findDate(text, today, flags) {
    var found = [], m;
    var reISO = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
    while ((m = reISO.exec(text))) found.push(iso(+m[1], +m[2], +m[3]));
    var reMD = new RegExp('\\b' + MON_RE + '\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?!\\s*,?\\s*\\d{4})', 'ig');
    while ((m = reMD.exec(text))) found.push(resolve(MONTHS.indexOf(m[1].toLowerCase()) + 1, +m[2], today));
    var reDM = new RegExp('\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?' + MON_RE + '\\b', 'ig');
    while ((m = reDM.exec(text))) found.push(resolve(MONTHS.indexOf(m[2].toLowerCase()) + 1, +m[1], today));
    if (/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/.test(text)) flags.push('ambiguous_date');
    var uniq = found.filter(function (d, i) { return found.indexOf(d) === i; });
    if (uniq.length > 1) flags.push('several_dates');
    return uniq.length ? uniq[0] : null;
  }

  function findContact(text) {
    var lines = text.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    if (!lines.length) return null;
    var last = lines[lines.length - 1], m;
    if ((m = last.match(/^(?:thanks|thx|thank you|cheers|regards|ty)[,.!]?\s+([A-Za-z]+)$/i))) return cap(m[1]);
    if ((m = last.match(/(?:thanks|thx|thank you|cheers|regards|ty)[,.!]?\s+([A-Za-z]+)\s*$/i))) return cap(m[1]);
    if (/^[A-Za-z]+$/.test(last) && lines.length > 1 && /^(?:thanks|thx|thank you|cheers|regards|ty)[,.!]?$/i.test(lines[lines.length - 2])) return cap(last);
    return null;
  }

  // The checks a careful person would do before quoting. Reason codes match seed.py.
  function check(read, ctx) {
    var byCode = {};
    ctx.catalogue.forEach(function (c) { byCode[c.sku] = c; });
    var reasons = [], lead = 0;
    if (!read.customer) reasons.push('customer');
    if (!read.items.length) reasons.push('items');
    read.items.forEach(function (it) {
      var c = byCode[it.sku];
      if (!c) { reasons.push('unknown_sku:' + it.sku); return; }
      lead = Math.max(lead, c.lead_days);
      if (it.qty === null) reasons.push('quantity:' + it.sku);
      else if (it.qty < c.min_qty) reasons.push('below_minimum:' + it.sku);
    });
    if (!read.needed_by) reasons.push('needed_by');
    else if (read.needed_by < addDays(ctx.today, lead)) reasons.push('too_soon');
    return { reasons: reasons, lead: lead, earliest: addDays(ctx.today, lead) };
  }

  function read(text, ctx) {
    var flags = [];
    var customerMatch = text.match(/\bcustomer\s*(\d{1,3})\b/i);
    var po = text.match(/\b(?:P\.?\s?O(?![A-Za-z])\.?|purchase\s+order)\s*(?:#|no\.?|number)?\s*:?\s*([A-Za-z]*\d[\w-]*)/i);
    var ship = text.match(/\bship(?:ping)?(?:\s+it)?\s+to\s+(?:our\s+|the\s+)?([A-Za-z]+)/i);
    var out = {
      customer: customerMatch ? 'Customer ' + pad(+customerMatch[1]) : null,
      contact: findContact(text),
      items: findItems(text, flags),
      needed_by: findDate(text, ctx.today, flags),
      asap: /\b(asap|urgent|rush)\b/i.test(text),
      po: po ? po[1] : null,
      ship_to: ship ? cap(ship[1]) : null,
      flags: flags
    };
    out.asap = out.asap && !out.needed_by; // a real date wins over "urgent"
    var c = check(out, ctx);
    out.reasons = c.reasons;
    out.lead_days = c.lead;
    out.earliest = c.earliest;
    out.decision = flags.length ? 'human_review' : (c.reasons.length ? 'follow_up' : 'ready_to_quote');
    return out;
  }

  // Plain-language lines for the checklist and the draft reply.
  function describe(code, r, ctx) {
    var p = code.split(':'), k = p[0], arg = p[1], cat = {};
    ctx.catalogue.forEach(function (c) { cat[c.sku] = c; });
    switch (k) {
      case 'customer': return { check: 'Customer identified', ask: 'Which customer account is this for?' };
      case 'items': return { check: 'At least one product code found', ask: 'Which product codes and quantities do you need?' };
      case 'unknown_sku': return { check: 'Product code ' + arg + ' is in the catalogue', ask: 'I do not recognise the product code ' + arg + '. Could you confirm it?' };
      case 'quantity': return { check: 'Quantity found for ' + arg, ask: 'How many of ' + arg + ' do you need?' };
      case 'below_minimum': return { check: 'Quantity of ' + arg + ' meets the minimum of ' + cat[arg].min_qty, ask: 'The minimum order for ' + arg + ' is ' + cat[arg].min_qty + '. Would you like to raise the quantity?' };
      case 'needed_by': return { check: 'Needed-by date given', ask: r.asap ? 'You mentioned it is urgent. What date do you need it by?' : 'What date do you need it by?' };
      case 'too_soon': return { check: 'Needed-by date allows for the lead time', ask: 'The lead time for these items is ' + r.lead_days + ' days, so the earliest delivery is ' + r.earliest + '. Does that work for you?' };
    }
    return { check: code, ask: '' };
  }

  function flagText(flag) {
    var p = flag.split(':'), k = p[0], arg = p[1];
    if (k === 'quantity_in_words') return 'The quantity for ' + arg + ' looks like it is written in words.';
    if (k === 'ambiguous_date') return 'A date like 28/11 could be day/month or month/day.';
    if (k === 'several_dates') return 'More than one date appears in the message.';
    if (k === 'odd_quantity') return 'The quantity for ' + arg + ' looks unusual.';
    return flag;
  }

  function equalItems(a, b) {
    function key(l) { return l.map(function (i) { return i.sku + '=' + (i.qty === null ? 'none' : i.qty); }).sort().join('|'); }
    return key(a) === key(b);
  }

  // Compare the reader with the labelled answers.
  function evaluate(samples, ctx) {
    var fields = ['customer', 'contact', 'items', 'needed_by', 'po', 'ship_to'];
    var fieldOk = {}, byCat = {}, misses = [];
    fields.forEach(function (f) { fieldOk[f] = 0; });
    var tot = { n: 0, correct: 0, handed: 0, wrong: 0, falseReady: 0, falseFollow: 0 };
    samples.forEach(function (s) {
      var r = read(s.text, ctx), t = s.truth, cat = byCat[s.category] || (byCat[s.category] = { n: 0, correct: 0, handed: 0, wrong: 0 });
      tot.n++; cat.n++;
      var got = {
        customer: r.customer, contact: r.contact, items: r.items, needed_by: r.needed_by, po: r.po, ship_to: r.ship_to
      };
      fields.forEach(function (f) {
        var a = got[f], b = t[f], ok;
        if (f === 'items') ok = equalItems(a, b);
        else if (typeof a === 'string' && typeof b === 'string') ok = a.toLowerCase() === b.toLowerCase();
        else ok = a === b;
        if (ok) fieldOk[f]++;
        else misses.push({ id: s.id, category: s.category, field: f, expected: b, got: a, text: s.text });
      });
      if (r.decision === t.decision) { tot.correct++; cat.correct++; }
      else if (r.decision === 'human_review') { tot.handed++; cat.handed++; }
      else {
        tot.wrong++; cat.wrong++;
        if (r.decision === 'ready_to_quote') tot.falseReady++; else tot.falseFollow++;
        misses.push({ id: s.id, category: s.category, field: 'decision', expected: t.decision, got: r.decision, text: s.text });
      }
    });
    return { total: tot, fields: fieldOk, byCategory: byCat, misses: misses };
  }

  return { read: read, check: check, describe: describe, flagText: flagText, evaluate: evaluate, addDays: addDays };
});
