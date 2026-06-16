# EV Export Management

Internal management system for new-energy vehicle export cooperation between China and Ethiopia.

The system currently covers:

- Vehicle resources and supplier source records
- Inquiry and quote version management
- Staff accounts and role-based permissions
- Partner/customer views
- Chinese and English UI switching

## Development

```bash
npm install
npm run dev
```

Local URLs:

- Web app: `http://127.0.0.1:5173/`
- API: `http://127.0.0.1:3001/`

## Important Project Rules

Internationalization and workflow status rules are documented here:

- [Internationalization and Status Code Rules](docs/i18n-and-status-codes.md)

Key rule:

Business logic and database values should use stable internal codes. Chinese and English should only be display labels.

Example:

```text
Stored value: pending_review
Chinese UI: 待审核
English UI: Pending Review
```

When adding new features, add both Chinese and English UI labels and avoid storing display text as workflow state.
