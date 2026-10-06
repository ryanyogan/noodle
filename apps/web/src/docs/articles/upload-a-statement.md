---
title: Uploading a statement
summary: Bring in an Account's Transactions from a file you download from your bank.
section: Features
order: 130
---

If you would rather not connect a bank, or Noodle cannot reach yours, you can upload a statement. You download a file from your bank's site and give it to Noodle. Noodle reads the lines and brings them in as Transactions.

## Where to find it

Statements are uploaded on the Account they belong to. Open **Accounts**, then open the Account.

If the Account is not in Noodle yet, add it first with **Add Account**.

## Upload a statement

1. On your bank's site, download a statement for the Account as a CSV, OFX or QFX file.
2. In Noodle, open the Account and press **Upload statement**. On a narrow phone the button reads Upload.
3. Choose the file.
4. Look at the **Preview**. It shows the lines Noodle read.
5. If the preview looks right, press **Import**. The button says how many lines it will bring in, for example "Import 42 lines".

## If the columns look wrong

A CSV file can be laid out many ways. If dates or amounts look wrong in the preview, open **Columns look wrong?** and tell Noodle which columns are which.

- Say whether the first row names the columns.
- Choose the date format.
- Say how amounts are written: one column where money out is negative, one column where money out is positive, or two columns for money out and money in.

The preview updates so you can check before you import.

## What happens to each line

- **Money out** comes in as Transactions to assign. Noodle files what it can, and asks you about the rest in Review.
- **Money in** is recorded as income.
- **Payments to a card and refunds** are brought in, but do not count as spending.

If the statement ends with a balance, Noodle offers it, so you can use it as the Account's balance or what is owed.

## Nothing is added twice

Uploading the same statement again, or one that overlaps an earlier one, adds nothing twice. Lines already in the Account are left out. So are lines you deleted from it.

If you had already entered a purchase with Quick Add, Noodle Matches it with the statement's line so it counts once.

## Good to know

- Each Account's page keeps a list of **Imported statements**.
- An Account that syncs with its bank gets its Transactions from the bank on its own.
- If nothing in a file can be read, Noodle says so and nothing changes. Try another file from your bank.
- You can connect the bank later. What the bank brings in is not added on top of what your statements already brought in.

## Related

- [Bringing in your spending](/docs/bringing-in-spending)
- [Accounts and connecting a bank](/docs/accounts-and-banks)
- [Review and Rules](/docs/review-and-rules)
- [Quick Add](/docs/quick-add)
