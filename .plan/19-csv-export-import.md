# 19: CSV export and import of drafts

**Effort:** S · **Depends on:** none (best with 01)

## Why

Agencies and larger teams review copy outside Shopify. They send it to a client, a copy editor or a legal reviewer in a spreadsheet. Today they would have to copy and paste each draft by hand. A round-trip through a spreadsheet makes Descripta fit into existing review processes, and is a common request from merchants on paid plans.

## What to build

- **Export** from the review queue (plan 01) or History. Downloads a CSV of the selected or filtered drafts with these columns: `draft_id, product_id, product_title, product_url, status, current_description, new_description, new_seo_title, new_seo_description, flags`.
- **Import** a CSV with the same columns. The app matches rows by `draft_id`, takes the edited `new_*` fields, sanitises them and shows a **preview of the changes** before anything is saved.
- After importing, the edited drafts are ready to apply in bulk as usual. Import updates drafts only; it never writes straight to Shopify.

## Implementation

1. **Export route.** `app/routes/app.api.drafts.export.tsx`. A loader that returns `text/csv` with `Content-Disposition: attachment`. Write CSV escaping by hand (quote every field, double any quotes inside), or add a small library such as `papaparse`. Start the file with a UTF-8 BOM so Excel opens accented characters correctly.
2. **HTML in cells.** Export descriptions as HTML in the CSV (lossless), plus a `new_description_text` column with plain text for easy reading. Import reads only the HTML column.
3. **Import route.** `app/routes/app.drafts.import.tsx`. File upload with a form, at most about 2 MB and 1,000 rows. Parse it, then for each row:
   - Find the `Generation` by `id` **and** `shop`, so one shop can't edit another's drafts.
   - Skip rows whose draft is already applied or reverted.
   - Run `sanitizeHtml` and the SEO length cuts used in the `apply` intent of `app/routes/app.products.$id.tsx`.
   - Build a change list (old and new for each field). Nothing is saved yet.
4. **Confirm step.** Show the change list ("42 drafts changed, 3 rows skipped: already applied"). **Save changes** updates the `Generation` rows in one transaction.
5. **Record the edit.** Add `editedVia String?` ("csv") to `Generation`, so History shows that a draft was edited outside the app.

## Edge cases

- Spreadsheet apps that mangle IDs (Excel turning long numbers into `1.23E+12`). Use the string `draft_id` (a cuid) as the key, not the numeric product id.
- Excel saving the CSV with a different encoding or with semicolons as separators. Detect the separator from the header row, and accept UTF-8 with or without a BOM.
- Unknown or extra columns are ignored. Missing required columns are rejected with a clear message.

## Done when

- [ ] Exporting 20 drafts, editing 5 titles in Google Sheets and importing the file updates exactly those 5 drafts after confirmation.
- [ ] Rows from another shop's export are rejected.
- [ ] Accented characters survive a round trip through Excel.
