# Quote request intake demo

A small demo of turning free-form quote-request emails into a checked, structured request, with a person approving, and measuring how well it works on a labelled test set. Everything is **synthetic**: the customers, contacts, products and emails are invented. Nothing here comes from a real company's emails, catalogue, systems or code.

**No AI model runs in this demo.** The reader is a set of plain rules. The point is what surrounds the reader (the checks, the hand-off to a person, and the measurement), which stays the same if a model does the reading instead.

## What it does

1. **Reads** a request: the customer, products and quantities, needed-by date, PO number and ship-to.
2. **Checks** it against a small catalogue: is the product code real, is the quantity at or above the minimum, does the date allow for the lead time.
3. **Routes** it: *ready to quote* (a person prices it), *needs follow-up* (a reply is drafted), or *needs a person to look* (the reader was unsure, such as a quantity written in words or a date like 28/11, so it does not guess).
4. **Measures itself** on 80 labelled made-up emails: decisions correct, handed to a person, wrong, and, counted separately, marked ready when it was not.

Nothing is sent or entered automatically. A person approves every request.

## Files

- **`seed.py`**: writes the labelled test emails (`web/samples.json`) with a fixed random seed, so they are repeatable: 80 emails in four styles (clean, informal, tricky, incomplete), the correct answer for each, a small catalogue with minimum quantities and lead times, and three hand-written "known weak spots".
- **`web/extractor.js`**: the reader and the scorer. Plain JavaScript that runs in the browser and in Node.
- **`web/`**: the page (`index.html`, `qi.js`, `qi.css`). It runs the same `extractor.js` on the sample you pick and on the whole test set, so the score shown is the score of the code you are using.
- **`evaluate.mjs`**: the same scoring from the command line.

## Run it

Python 3 (standard library only) and, for the command-line scorer, Node. No packages.

```bash
python3 seed.py web/samples.json     # optional: regenerate the synthetic emails
node evaluate.mjs                    # score the reader; add --misses to list every miss
cd web && python3 -m http.server 8000
```

Then open http://localhost:8000. (Use a local server rather than opening the file directly, because the page fetches `samples.json`.)

## Limits worth knowing

- The same person wrote the reader and the test emails, which flatters the score. A real test uses real past requests, including ones nobody thought of in advance.
- Three realistic requests fool the reader without any warning: a product only mentioned as a past order, a later correction ("make that 300"), and a PO the customer wants cancelled. They are in `samples.json` as `weak_spots` and shown on the page. This is why a person approves every request.

## Using this for a real business

A real version is usually an AI model doing the reading, which copes with messier text than rules can, with the same checks, the same hand-off, human approval, and the same kind of test set to show whether the model is good enough before it touches live work. Real requests, a real catalogue and your order system replace the made-up ones.

## Author

Vaughn Dewar, [Ideal Consulting](https://www.idealconsulting.ca/), Toronto. Released under the MIT License.
