import { expect, test } from 'vitest';
const { quoteCell, reportCsv } = require('./lib-report-csv.cts');

test.each(['=1+1', '+1', '-1', '@SUM(1)', '＝1+1', '＋1', '－1', '＠SUM(1)', ' =1', '\t=1', '\r=1', '\n=1', '\u0000=1', '\uFEFF=1', '=1,"\n=2'])('数式をセルの文字列にする: %j', (value) => {
  expect(quoteCell(value)).toBe('"\t' + value.replaceAll('"', '""') + '"');
});
test.each(['山田 太郎', 'alice@example.com', '通常,"名前"\n続き', '', null])('通常の値と CSV の列境界を保持する: %j', (value) => {
  expect(quoteCell(value)).toBe('"' + String(value ?? '').replaceAll('"', '""') + '"');
});
test('全セルに同じ境界を適用して BOM と行区切りを保持する', () => {
  expect(
    reportCsv([
      ['投稿者', '理由'],
      ['=1', '+2'],
    ]),
  ).toBe('\uFEFF"投稿者","理由"\r\n"\t=1","\t+2"');
});
