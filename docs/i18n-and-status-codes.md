# Internationalization and Status Code Rules

This project supports Chinese and English. All future features must follow these rules so the two languages do not affect business data or system logic.

## Core Principle

Business data and system logic must not depend on display language.

The system should store stable internal codes, then translate those codes for the current interface language.

Example:

```text
Stored value: pending_review
Chinese UI: 待审核
English UI: Pending Review
```

The internal code is the identity. The translated text is only the display name.

## Do Not Store UI Text as State

Avoid storing Chinese or English UI text as workflow states in the database.

Do not store:

```text
待审核
Pending Review
报价待客户审核
Quote Sent
```

Store:

```text
pending_review
quote_sent
revision_requested
quote_accepted
pi_pending
pi_confirmed
```

## Why This Matters

Using internal codes keeps the system stable:

- Chinese and English can change independently.
- Adding another language later is easier.
- Backend logic does not break when display wording changes.
- Reporting and filtering become more reliable.
- Mobile, web, and exported documents can share the same business state.

## UI Text Rule

All fixed interface text should be added to the translation dictionary instead of being written directly inside components.

Examples of fixed interface text:

- Navigation labels
- Buttons
- Table headers
- Empty states
- Form labels
- Tooltip text
- Status labels
- Validation messages

## Business Data Rule

Do not translate user-entered or business-specific data unless there is a separate approved translated field.

Usually keep these values as-is:

- Customer names
- Vehicle model names
- Supplier names
- Port names
- VINs
- Uploaded file names
- Free-text notes

## Recommended Status Pattern

Use constants or mapping tables:

```ts
const quoteStatusLabels = {
  pending_review: {
    zh: '待审核',
    en: 'Pending Review',
  },
  quote_sent: {
    zh: '报价待客户审核',
    en: 'Quote Sent',
  },
}
```

Business logic should check the code:

```ts
if (quote.status === 'pending_review') {
  // allow review
}
```

UI should render the label:

```ts
quoteStatusLabels[quote.status][language]
```

## Current System Note

Some existing records still use Chinese status text, such as `待审核` and `报价待客户审核`.

Short term:

- Continue translating these existing values at display time.

Long term:

- Migrate stored statuses to stable internal codes.
- Keep Chinese and English labels only in the translation layer.

## Checklist for New Features

Before finishing a new feature, confirm:

- New fixed UI text has both Chinese and English labels.
- New workflow states are stored as internal codes.
- Backend checks use internal codes, not displayed labels.
- User-entered business data is not automatically translated.
- The feature works after switching languages.
