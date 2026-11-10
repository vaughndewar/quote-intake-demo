// Quote request intake demo. Runs the rules-based reader (extractor.js) on made-up emails,
// shows what it read, the checks and a decision, and scores the reader on a labelled set.
(function () {
  'use strict';

  var data, ctx, byId = {}, catalogue = {};
  var GROUPS = [
    ['clean', 'Clean emails'], ['informal', 'Informal emails'], ['tricky', 'Tricky emails'],
    ['incomplete', 'Incomplete requests'], ['weak', 'Known weak spots']
  ];
  var DECISIONS = {
    ready_to_quote: ['✓ Ready to quote', 'Complete and consistent with the catalogue. A person prices it.'],
    follow_up: ['✗ Needs follow-up', 'Something is missing or does not work. A reply is drafted for a person to send.'],
    human_review: ['⚠ Needs a person to look', 'The reader was not sure how to read part of it, so it did not guess.']
  };
  var CAT_NAMES = { clean: 'Clean emails', informal: 'Informal emails', tricky: 'Tricky emails', incomplete: 'Incomplete requests' };
  var FIELD_NAMES = { customer: 'Customer', contact: 'Contact', items: 'Products and quantities', needed_by: 'Needed-by date', po: 'PO number', ship_to: 'Ship-to' };

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { if (k === 'text') n.textContent = attrs[k]; else n.setAttribute(k, attrs[k]); });
    (kids || []).forEach(function (c) { n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function $(id) { return document.getElementById(id); }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function pct(a, b) { return (b ? (100 * a / b) : 0).toFixed(1) + '%'; }
  function itemsText(items) {
    if (!items || !items.length) return 'none';
    return items.map(function (i) { return (i.qty === null ? '?' : i.qty) + ' × ' + i.sku; }).join(', ');
  }
  function show(v) {
    if (v === null || v === undefined) return 'nothing';
    if (Array.isArray(v)) return itemsText(v);
    return String(v);
  }

  function table(caption, head, rows, cls) {
    var t = el('table', { 'class': 'data' + (cls ? ' ' + cls : '') });
    if (caption) t.appendChild(el('caption', { text: caption }));
    var tr = el('tr');
    head.forEach(function (h) { tr.appendChild(el('th', { scope: 'col', 'class': h.num ? 'num' : '', text: h.label })); });
    t.appendChild(el('thead', {}, [tr]));
    var tb = el('tbody');
    rows.forEach(function (cells) {
      var row = el('tr');
      cells.forEach(function (c, i) {
        var cell = el(i === 0 ? 'th' : 'td', Object.assign({}, i === 0 ? { scope: 'row' } : {}, head[i].num ? { 'class': 'num' } : {}));
        if (c && c.nodeType) cell.appendChild(c); else cell.textContent = c;
        row.appendChild(cell);
      });
      tb.appendChild(row);
    });
    t.appendChild(tb);
    return t;
  }

  // ---- The reader panel -----------------------------------------------------
  function describeAll(r) { return r.reasons.map(function (c) { return QuoteReader.describe(c, r, ctx); }); }

  function renderRead(r) {
    var needed = r.needed_by ? r.needed_by : (r.asap ? 'Urgent, but no date given' : 'Not given');
    var prods = el('div');
    if (!r.items.length) prods.textContent = 'None found';
    r.items.forEach(function (i) {
      var c = catalogue[i.sku];
      prods.appendChild(el('div', { text: (i.qty === null ? 'quantity not found' : i.qty) + ' × ' + i.sku + ' (' + (c ? c.name : 'not in catalogue') + ')' }));
    });
    var rows = [
      ['Customer', r.customer || 'Not found'],
      ['Contact', r.contact || 'Not found'],
      ['Products', prods],
      ['Needed by', needed],
      ['PO number', r.po || 'None given'],
      ['Ship to', r.ship_to || 'Not given']
    ];
    var host = $('read-table');
    clear(host);
    host.appendChild(table('What the reader found', [{ label: 'Field' }, { label: 'Read as' }], rows));
  }

  function renderChecks(r) {
    var codes = r.reasons;
    function any(prefix) { return codes.filter(function (c) { return c === prefix || c.indexOf(prefix + ':') === 0; }); }
    function asks(list) { return list.map(function (c) { return QuoteReader.describe(c, r, ctx).ask; }).join(' '); }
    var unknown = any('unknown_sku'), qty = any('quantity').concat(any('below_minimum'));
    var list = [
      ['Customer identified', any('customer').length ? 'fail' : 'pass', any('customer').length ? 'No customer account found in the message.' : r.customer],
      ['At least one product code found', any('items').length ? 'fail' : 'pass', any('items').length ? 'No product code like BRK-200 found.' : r.items.length + ' found'],
      ['Every product code is in the catalogue', unknown.length ? 'fail' : (r.items.length ? 'pass' : 'skip'), unknown.length ? unknown.map(function (c) { return c.split(':')[1]; }).join(', ') + ' not in the catalogue.' : ''],
      ['Every quantity is present and meets the minimum', qty.length ? 'fail' : (r.items.length ? 'pass' : 'skip'), qty.length ? asks(qty) : ''],
      ['Needed-by date given', any('needed_by').length ? 'fail' : 'pass', any('needed_by').length ? (r.asap ? 'Marked urgent, but no date.' : 'No date found.') : r.needed_by],
      ['Date allows for the lead time', !r.needed_by ? 'skip' : (any('too_soon').length ? 'fail' : 'pass'),
        !r.needed_by ? '' : (any('too_soon').length ? asks(any('too_soon')) : 'Lead time is ' + r.lead_days + ' days; earliest is ' + r.earliest + '.')],
      ['Reader is confident in what it read', r.flags.length ? 'warn' : 'pass', r.flags.map(QuoteReader.flagText).join(' ')]
    ];
    var label = { pass: '✓ Pass', fail: '✗ Fail', warn: '⚠ Check', skip: '– Skipped' };
    var host = $('checklist');
    clear(host);
    list.forEach(function (x) {
      var body = el('span', {}, [x[0]]);
      if (x[2]) body.appendChild(el('span', { 'class': 'd', text: x[2] }));
      host.appendChild(el('li', {}, [el('span', { 'class': 'st ' + x[1], text: label[x[1]] }), body]));
    });
  }

  function renderDecision(r) {
    var d = $('decision');
    d.setAttribute('data-decision', r.decision);
    clear(d);
    d.appendChild(el('b', { text: DECISIONS[r.decision][0] }));
    d.appendChild(el('span', { text: DECISIONS[r.decision][1] }));
  }

  function renderDraft(r) {
    var title = $('draft-title'), out;
    var name = r.contact || 'there';
    if (r.decision === 'ready_to_quote') {
      title.textContent = 'Note for the person who prices it';
      out = 'Ready to price.\n\nCustomer: ' + r.customer + '\nNeeded by: ' + r.needed_by + '\nPO: ' + (r.po || '-') + '\nShip to: ' + (r.ship_to || '-') + '\n\nLines:\n' +
        r.items.map(function (i) { return '  ' + i.qty + ' x ' + i.sku + '  ' + catalogue[i.sku].name; }).join('\n');
    } else if (r.decision === 'follow_up') {
      title.textContent = 'Draft reply (not sent)';
      out = 'Hi ' + name + ',\n\nThanks for your request. Before I can quote it, I need a few details:\n\n' +
        describeAll(r).map(function (d) { return '- ' + d.ask; }).join('\n') + '\n\nThanks,\n[Your name]';
    } else {
      title.textContent = 'Why a person needs to look';
      out = 'The reader was not sure how to read this request:\n\n' + r.flags.map(function (f) { return '- ' + QuoteReader.flagText(f); }).join('\n') +
        '\n\nA person should read the original email before anything is sent or entered.';
    }
    $('draft').textContent = out;
  }

  function run(text) {
    var r = QuoteReader.read(text, ctx);
    renderDecision(r);
    renderRead(r);
    renderChecks(r);
    renderDraft(r);
  }

  // ---- Scoring panel --------------------------------------------------------
  function tile(big, label) {
    return el('div', { 'class': 'tile' }, [el('b', { text: big }), el('span', { 'class': 'label', text: label })]);
  }

  function renderScore() {
    var ev = QuoteReader.evaluate(data.samples, ctx), t = ev.total;
    $('n-total').textContent = t.n;
    var tiles = $('tiles');
    clear(tiles);
    tiles.appendChild(tile(pct(t.correct, t.n), 'Decisions correct (' + t.correct + ' of ' + t.n + ')'));
    tiles.appendChild(tile(String(t.handed), 'Handed to a person (' + pct(t.handed, t.n) + ')'));
    tiles.appendChild(tile(String(t.wrong), 'Decisions wrong'));
    tiles.appendChild(tile(String(t.falseReady), 'Marked ready when it was not'));

    // Which requests had a misread field, and did the reader warn about them?
    var bad = {}, id;
    ev.misses.forEach(function (m) { if (m.field !== 'decision') bad[m.id] = true; });
    var ids = Object.keys(bad), warned = 0;
    ids.forEach(function (i) { if (QuoteReader.read(byId[i].text, ctx).decision === 'human_review') warned++; });
    var silent = ids.length - warned;
    $('silent-note').textContent = ids.length + ' requests had at least one field read wrongly. ' + warned + ' of them were handed to a person, and ' + silent +
      ' went through without a warning.' + (silent === 0 ? ' On this test set every misread was caught, but the weak spots below show that will not always be true.' : '');

    var cats = Object.keys(ev.byCategory).map(function (k) {
      var c = ev.byCategory[k];
      return [CAT_NAMES[k] || k, String(c.n), String(c.correct), String(c.handed), String(c.wrong)];
    });
    var host = $('cat-table');
    clear(host);
    host.appendChild(table('Results by kind of request', [{ label: 'Kind' }, { label: 'Requests', num: 1 }, { label: 'Correct', num: 1 }, { label: 'Handed to a person', num: 1 }, { label: 'Wrong', num: 1 }], cats, 'mid'));

    var fields = Object.keys(FIELD_NAMES).map(function (f) { return [FIELD_NAMES[f], ev.fields[f] + ' of ' + t.n, pct(ev.fields[f], t.n)]; });
    host = $('field-table');
    clear(host);
    host.appendChild(table('Results by field', [{ label: 'Field' }, { label: 'Read correctly', num: 1 }, { label: 'Share', num: 1 }], fields, 'mid'));

    var misses = ev.misses.filter(function (m) { return m.field !== 'decision'; }).map(function (m) {
      return [m.id + ' (' + (CAT_NAMES[m.category] || m.category).toLowerCase() + ')', FIELD_NAMES[m.field], show(m.expected), show(m.got)];
    });
    host = $('miss-table');
    clear(host);
    host.appendChild(table('Fields not read correctly', [{ label: 'Request' }, { label: 'Field' }, { label: 'Correct answer' }, { label: 'Read as' }], misses, 'mid'));
    $('miss-details').querySelector('summary').textContent = 'Fields it did not read correctly (' + misses.length + ')';
  }

  function renderWeak() {
    var host = $('weak');
    clear(host);
    data.weak_spots.forEach(function (w) {
      var r = QuoteReader.read(w.text, ctx);
      var btn = el('button', { type: 'button', text: 'Load into the reader' });
      btn.addEventListener('click', function () { $('sample').value = w.id; load(w.id); $('try').scrollIntoView(); });
      host.appendChild(el('div', { 'class': 'card weak' }, [
        el('h4', { text: w.title }),
        el('pre', { text: w.text }),
        el('p', {}, [el('strong', { text: 'A person sees: ' }), w.what_a_person_sees]),
        el('p', {}, [el('strong', { text: 'The reader did: ' }), DECISIONS[r.decision][0] + '. Products: ' + itemsText(r.items) + '. PO: ' + (r.po || 'none') + '.']),
        btn
      ]));
    });
  }

  // ---- Wiring ---------------------------------------------------------------
  function load(id) {
    var s = byId[id];
    if (!s) return;
    $('text').value = s.text;
    run(s.text);
  }

  function init() {
    ctx = { catalogue: data.catalogue, today: data.demo_today };
    data.catalogue.forEach(function (c) { catalogue[c.sku] = c; });
    data.samples.forEach(function (s) { byId[s.id] = s; });
    data.weak_spots.forEach(function (w) { byId[w.id] = w; });

    var sel = $('sample');
    var custom = el('option', { value: '', text: '(your own text)' });
    custom.hidden = true;
    sel.appendChild(custom);
    GROUPS.forEach(function (g) {
      var list = g[0] === 'weak' ? data.weak_spots : data.samples.filter(function (s) { return s.category === g[0]; });
      var og = el('optgroup', { label: g[1] });
      list.forEach(function (s) {
        var first = s.text.replace(/\s+/g, ' ').replace(/^(hello team,|hello,|hi,|hey -|hey|hi)\s*/i, '');
        og.appendChild(el('option', { value: s.id, text: s.id + ' · ' + (first.length > 58 ? first.slice(0, 58) + '…' : first) }));
      });
      sel.appendChild(og);
    });
    var start = data.samples.filter(function (s) { return s.category === 'informal'; })[0].id;
    sel.value = start;
    load(start);
    sel.addEventListener('change', function () { load(sel.value); });
    $('text').addEventListener('input', function () { sel.value = ''; run($('text').value); });

    renderScore();
    renderWeak();
  }

  fetch('samples.json').then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }).then(function (d) { data = d; init(); }).catch(function () {
    $('decision').textContent = 'The demo data could not be loaded. Please try again later.';
  });
})();
