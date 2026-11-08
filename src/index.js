#!/usr/bin/env node
// schoology-mcp: an MCP server that lets an AI assistant read your Schoology (upcoming and overdue
// assignments, events, courses and their materials). Read-only. Works through the website with your
// own sign-in, so no API key is needed.
//
//   schoology-mcp login   open a browser window to sign in once (the session is saved locally)
//   schoology-mcp check   test that it works
//   schoology-mcp         run the MCP server (your MCP client starts this)
//
// Environment: SCHOOLOGY_DOMAIN (e.g. yourschool.schoology.com), optional SCHOOLOGY_EMAIL (your school
// Google account, to pick it if Google asks which account), SCHOOLOGY_BROWSER=chrome, SCHOOLOGY_MCP_HOME.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { Schoology, login } from './schoology.js';

const domain = process.env.SCHOOLOGY_DOMAIN;
const sc = new Schoology({ domain, email: process.env.SCHOOLOGY_EMAIL, browserChannel: process.env.SCHOOLOGY_BROWSER || undefined, headless: process.env.SCHOOLOGY_HEADLESS !== '0' });

const cmd = process.argv[2];
if (cmd === 'login') {
  try {
    await login(process.argv[3] || domain);
  } catch (e) {
    console.error('✗ ' + e.message);
    process.exitCode = 1;
  }
  process.exit();
}
if (cmd === 'check') {
  try {
    console.log(await sc.courses());
    const u = await sc.upcoming();
    console.log('\nUpcoming:\n' + (u.upcoming_assignments || '(nothing)'));
    console.log('\n✓ Schoology works.');
  } catch (e) {
    console.error('✗ ' + e.message);
    process.exitCode = 1;
  }
  await sc.close();
  process.exit();
}

const server = new McpServer({ name: 'schoology', version: '1.0.0' });
const safely = (fn) => async (args) => {
  try {
    const r = await fn(args);
    return { content: [{ type: 'text', text: typeof r === 'string' ? r : JSON.stringify(r, null, 1) }] };
  } catch (e) {
    return { isError: true, content: [{ type: 'text', text: e.message }] };
  }
};

server.registerTool(
  'schoology_upcoming',
  {
    title: 'Upcoming and overdue',
    description: 'Schoology: upcoming assignments with due dates, overdue assignments, and upcoming events across all courses. Read-only.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  safely(() => sc.upcoming()),
);

server.registerTool(
  'schoology_courses',
  { title: 'Courses', description: "The student's current Schoology courses. Read-only.", inputSchema: {}, annotations: { readOnlyHint: true } },
  safely(() => sc.courses()),
);

server.registerTool(
  'schoology_course',
  {
    title: 'Course materials',
    description: "A course's materials page (folders, assignments, files, posts) as text. Give part of the course name. Read-only.",
    inputSchema: { course: z.string().describe('Part of the course name') },
    annotations: { readOnlyHint: true },
  },
  safely((a) => sc.course(a.course)),
);

const close = async () => {
  await sc.close();
  process.exit(0);
};
process.on('SIGINT', close);
process.on('SIGTERM', close);
process.stdin.on('end', close);

await server.connect(new StdioServerTransport());
