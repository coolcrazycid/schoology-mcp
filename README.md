# schoology-mcp

An [MCP](https://modelcontextprotocol.io) server that lets AI assistants like Claude read your **Schoology**: what's due, what's overdue, upcoming events, your courses and their materials.

It needs **no API key**. Students usually can't get Schoology API keys, so it works through the website with **your own sign-in** instead (including "Sign in with Google" or your school's single sign-on). It's **read-only**: it loads pages and the site's own read-only data, and never submits, posts or changes anything.

## What your assistant can do

| Tool | What it returns |
|---|---|
| `schoology_upcoming` | Upcoming assignments with due dates, overdue assignments, and upcoming events across all your courses |
| `schoology_courses` | Your current courses |
| `schoology_course` | One course's materials page (folders, assignments, files, posts) as text (give part of the course name, like `physics`) |

Ask things like *"What's due this week?"*, *"Do I have anything overdue?"* or *"What's in this week's folder for AP Physics?"*

Many districts keep **grades** in a separate student information system. If yours uses StudentVue, see [studentvue-mcp](https://github.com/coolcrazycid/studentvue-mcp).

## Setup

You need [Node.js](https://nodejs.org) 18 or newer, plus Google Chrome, Microsoft Edge, Brave or Chromium for signing in.

```bash
git clone https://github.com/coolcrazycid/schoology-mcp.git
cd schoology-mcp
npm install          # also downloads a small headless Chromium for Playwright
```

**1. Sign in once.** This opens a normal browser window. Sign in to Schoology the way you usually do. The window closes by itself when you're in, and your session is saved in `~/.schoology-mcp/`.

```bash
SCHOOLOGY_DOMAIN="yourschool.schoology.com" npm run login
```

**2. Check that it works:**

```bash
SCHOOLOGY_DOMAIN="yourschool.schoology.com" npm run check
```

### Claude Code

```bash
claude mcp add schoology \
  -e SCHOOLOGY_DOMAIN="yourschool.schoology.com" \
  -e SCHOOLOGY_EMAIL="you@yourschool.org" \
  -- node /full/path/to/schoology-mcp/src/index.js
```

### Claude Desktop (or any MCP client)

```json
{
  "mcpServers": {
    "schoology": {
      "command": "node",
      "args": ["/full/path/to/schoology-mcp/src/index.js"],
      "env": {
        "SCHOOLOGY_DOMAIN": "yourschool.schoology.com",
        "SCHOOLOGY_EMAIL": "you@yourschool.org"
      }
    }
  }
}
```

### Options

| Variable | Meaning |
|---|---|
| `SCHOOLOGY_DOMAIN` | Your Schoology address, like `yourschool.schoology.com` (required) |
| `SCHOOLOGY_EMAIL` | Your school account's email, so the server can pick it if Google asks "Choose an account" (optional) |
| `SCHOOLOGY_BROWSER=chrome` | Read with your installed Chrome instead of Playwright's Chromium |
| `SCHOOLOGY_BROWSER_PATH` | The browser to sign in with, if it isn't found automatically |
| `SCHOOLOGY_MCP_HOME` | Where the session is saved (default `~/.schoology-mcp`) |

## How it works

- **Signing in:** `login` opens a regular browser window (not an automated one, so Google sign-in isn't blocked) with its own profile in `~/.schoology-mcp/login-profile`. Once Schoology's own data loads, the session cookies are saved to `~/.schoology-mcp/session.json`, readable only by you.
- **Reading:** the server loads that session into a headless browser and reads Schoology's home-page feeds (upcoming, overdue, events), your course list, and course pages.
- **Staying signed in:** when Schoology ends the session, the server opens your school's sign-in page in the background. If Google just asks which account to use, it picks yours. If it needs your password again, it asks you to run `login` again.

Your sign-in never goes to the AI. It only sees the text of the pages. Delete `~/.schoology-mcp` at any time to sign out.

## Notes

- Schoology is a product of PowerSchool. This project isn't affiliated with or endorsed by PowerSchool or any school. Use it only with your own account, and follow your school's rules.
- Schools can customize Schoology, and the site changes now and then. If something stops working, please open an issue.

## License

MIT
