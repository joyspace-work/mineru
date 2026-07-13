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

## AI-Assisted Source Import & Feishu Sync

This project features built-in zero-config support. By default, **it works out-of-the-box** using pre-configured Feishu Bitable variables and an AI API key (Aliyun DashScope). You do not need to configure anything to start testing.

### Custom Configuration (Optional)

If you want to use your own Feishu table or another AI provider (e.g., OpenRouter or OpenAI), copy `.env.example` to `.env` and set your own keys.

OpenRouter example:
```ini
AI_PROVIDER=openrouter
OPENROUTER_API_KEY=your_openrouter_key_here
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_SOURCE_IMPORT_MODEL=nvidia/nemotron-nano-12b-v2-vl:free
```

OpenAI example:
```ini
OPENAI_API_KEY=your_api_key_here
OPENAI_SOURCE_IMPORT_MODEL=gpt-4.1-mini
```

Restart `npm run dev` after changing `.env` to apply the overrides.

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
