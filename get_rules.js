import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';

const FEISHU_EXPERIENCES_TABLE_ID = 'tblwWEYbWbV3WGlH';
const envFile = readFileSync('.env', 'utf-8');
const baseTokenMatch = envFile.match(/FEISHU_BASE_TOKEN=(.*)/);
const token = baseTokenMatch ? baseTokenMatch[1] : '';

const args = ['base', '+record-list', '--base-token', token, '--table-id', FEISHU_EXPERIENCES_TABLE_ID, '--as', 'user', '--limit', '200', '--format', 'json'];
const result = execFileSync('lark-cli', args, { encoding: 'utf8', timeout: 15000 });
console.log(result);
