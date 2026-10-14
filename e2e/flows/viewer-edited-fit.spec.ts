import path from 'node:path';
import { openDatabase } from '../../app/src/main/lib-db.ts';
import { expect, test } from '../lib/harness.ts';
import { FIXTURE_POSTS } from '../lib/library.ts';

for (const [rotation, flipped] of [
  [90, 1],
  [270, 0],
] as const) {
  test(`回転${rotation}度・反転${flipped}のクロップ画像を全体表示する`, async ({ launchDot }) => {
    const { page } = await launchDot({
      posts: [{ ...FIXTURE_POSTS[0], width: 1200, height: 2400 }],
      seed: ({ saveFolder }) => {
        const { sqlite } = openDatabase(path.join(saveFolder, 'dot.db'));
        sqlite.prepare('UPDATE media SET rotation=?,flipped=?,cropX=0.1,cropY=0.2,cropWidth=0.7,cropHeight=0.6').run(rotation, flipped);
        sqlite.close();
      },
    });
    await page.locator('[data-slot="post-card"]').first().dblclick();
    await expect(page.locator('[data-slot="viewer-zoom-level"]')).toHaveText(/^\d+%$/);
    await expect
      .poll(() =>
        page.locator('[data-slot="viewer-image"]').evaluate((img) => {
          const image = img as HTMLImageElement;
          const wrapper = image.closest('[data-slot="viewer-zoom-wrapper"]');
          const canvas = image.parentElement;
          if (!wrapper || !canvas || !image.style.clipPath) return false;
          const percentages = image.style.clipPath.match(/[\d.]+(?=%)/g)?.map(Number);
          if (!percentages?.length) return false;
          const [top, right = top, bottom = top, left = right] = percentages.map((value) => value / 100);
          const width = image.offsetWidth,
            height = image.offsetHeight;
          const origin = canvas.getBoundingClientRect();
          const centerX = origin.left + image.offsetLeft + width / 2;
          const centerY = origin.top + image.offsetTop + height / 2;
          const matrix = new DOMMatrix(getComputedStyle(image).transform);
          const points = [
            [left * width, top * height],
            [(1 - right) * width, top * height],
            [left * width, (1 - bottom) * height],
            [(1 - right) * width, (1 - bottom) * height],
          ].map(([x, y]) => new DOMPoint(x - width / 2, y - height / 2).matrixTransform(matrix));
          const bounds = wrapper.getBoundingClientRect();
          return points.every((point) => point.x + centerX >= bounds.left - 2 && point.x + centerX <= bounds.right + 2 && point.y + centerY >= bounds.top - 2 && point.y + centerY <= bounds.bottom + 2);
        }),
      )
      .toBe(true);
  });
}
