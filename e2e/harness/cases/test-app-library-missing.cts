'use strict';

// #37（保存フォルダの欠落パス検出）を、実際のElectron
// mainプロセスを通して行き来させる。各シナリオは隔離されたDOT_CONFIG_DIR
// （test-app-taggroups.ctsと同じ形）に対して新規プロセスを起動するので、ここの
// 何一つとして実ライブラリに触れられない。
//
//   node e2e/harness/cases/test-app-library-missing.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '../../../app');
const { electronPath: resolveElectron } = require('../../../scripts/lib-electron-path.cts');

const electronPath = resolveElectron();
const { evalSource } = require('../../../scripts/lib-wait.cts');
const { seedLibrary } = require('../../../scripts/lib-seed-library.cts');
const { makePng } = require('../../../scripts/lib-sandbox-real-seed.cts');

function launch(configDir: string, evalJs: string, extraEnv: Record<string, string> = {}): Promise<Record<string, any>> {
  return new Promise((resolve) => {
    const env = Object.assign({}, process.env, {
      DOT_CONFIG_DIR: configDir,
      DOT_SMOKE: '1',
      DOT_SMOKE_EVAL: evalJs,
      ...extraEnv,
    });
    const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
    let out = '';
    child.stdout.on('data', (d) => {
      out += d.toString();
      process.stdout.write(d);
    });
    child.on('close', () => {
      let r: Record<string, any> = {};
      const m = out.match(/EVAL_RESULT (.+)/);
      if (m) {
        try {
          r = JSON.parse(m[1]);
        } catch {
          /* 無視 */
        }
      }
      resolve(r);
    });
  });
}

const results: Array<{ name: string; ok: boolean; detail: string }> = [];
function check(name: string, ok: boolean, detail: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}: ${detail}`);
}

(async () => {
  // --- シナリオA: 起動時、明示したsaveFolderがディスク上に存在しない -------
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dot-libmissing-a-'));
    const configDir = path.join(tmp, 'dot');
    const missingFolder = path.join(tmp, 'gone-library'); // 決して作られない
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder: missingFolder }));

    const evalJs = evalSource(async (_waits, _args) => {
      const status = await (window as any).dot.getLibraryStatus();
      const clear = await (window as any).dot.clearAll();
      const move = await (window as any).dot.pickSaveFolder();
      return { status, clear, move };
    }, {});
    // 製品の renderer が移動先を指定する旧 API は使わない。隔離 SMOKE プロセスの
    // main picker だけに一時ディレクトリを注入し、本番と同じ missing guard へ通す。
    const r = await launch(configDir, evalJs, { DOT_SMOKE_PICK_SAVE_FOLDER: path.join(tmp, 'elsewhere') });

    check('A1: 起動時に、明示した保存フォルダの欠落を検出する', !!(r.status && r.status.missing === true && r.status.path === missingFolder), JSON.stringify(r.status));
    check('A2: 欠落したフォルダは黙って再作成されない（mkdirしない）', !fs.existsSync(missingFolder), `existsSync(missingFolder)=${fs.existsSync(missingFolder)}`);
    check('A3: clear-allはblocked="missing"で拒否される', !!(r.clear && r.clear.ok === false && r.clear.blocked === 'missing'), JSON.stringify(r.clear));
    check('A4: move-save-folder（移動）は拒否され、空のsrcから黙って始まらない', !!(r.move && r.move.ok === false && r.move.error === 'library-missing'), JSON.stringify(r.move));

    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // --- シナリオB: 既存DBを持つライブラリを移動後に開き直す。コピー無し --
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dot-libmissing-b-'));
    const configDir = path.join(tmp, 'dot');
    const missingFolder = path.join(tmp, 'gone-library');
    const movedLibrary = path.join(tmp, 'moved-library');
    const emptyFolder = path.join(tmp, 'empty');
    const mediaOnlyFolder = path.join(tmp, 'media-only');
    const captureId = '1700000000000-aa01';
    const image = `${captureId}.png`;
    fs.mkdirSync(configDir, { recursive: true });
    fs.mkdirSync(path.join(missingFolder, '.trash'), { recursive: true });
    const imageBytes = makePng(32, 32, [80, 120, 160]);
    fs.writeFileSync(path.join(missingFolder, image), imageBytes);
    fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder: missingFolder }));
    seedLibrary(configDir, [{ captureId, image, capturedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', tags: ['before'] }]);
    fs.renameSync(missingFolder, movedLibrary);
    fs.mkdirSync(emptyFolder);
    fs.mkdirSync(path.join(mediaOnlyFolder, '.trash'), { recursive: true });
    fs.writeFileSync(path.join(mediaOnlyFolder, image), imageBytes);

    const evalJs = evalSource(
      async (_waits, args) => {
        const before = await (window as any).dot.getLibraryStatus();
        const empty = await (window as any).dot.applyRepoint(args.emptyFolder);
        const mediaOnly = await (window as any).dot.applyRepoint(args.mediaOnlyFolder);
        const rejectedConfig = await (window as any).dot.getConfig();
        const apply = await (window as any).dot.applyRepoint(args.movedLibrary);
        const after = await (window as any).dot.getLibraryStatus();
        const cfg = await (window as any).dot.getConfig();
        const snapshot = await (window as any).dot.listPosts();
        const retained = snapshot.posts.some((post: any) => post.captureId === args.captureId);
        const write = await (window as any).dot.updateTags(args.image, ['recovered']);
        return { before, empty, mediaOnly, rejectedConfig, apply, after, cfg, retained, write };
      },
      { movedLibrary, emptyFolder, mediaOnlyFolder, captureId, image },
    );
    const r = await launch(configDir, evalJs);

    check('B1: apply-repointは既存DBを持つ移動済みライブラリに対して成功する', !!(r.apply && r.apply.ok === true && r.apply.saveFolder === movedLibrary), JSON.stringify(r.apply));
    check('B2: 向け直しはコピーを伴わない＝古い（欠落した）フォルダは依然として無い', !fs.existsSync(missingFolder), `existsSync(missingFolder)=${fs.existsSync(missingFolder)}`);
    check('B3: 向け直しは移動済みの画像を変更しない', fs.existsSync(path.join(movedLibrary, '.trash')) && fs.readFileSync(path.join(movedLibrary, image)).equals(imageBytes), '画像とゴミ箱フォルダはそのまま');
    check('B4: 向け直し後、get-library-statusは解決済みと報告する', !!(r.after && r.after.missing === false && r.after.path === movedLibrary), JSON.stringify(r.after));
    check('B5: config.jsonが実際に書き換わった（get-configに反映される）', !!(r.cfg && r.cfg.saveFolder === movedLibrary), JSON.stringify(r.cfg));
    check('B6: 空フォルダを拒否し、DBを作成しない', !!(r.empty && r.empty.ok === false && r.empty.error === 'no-library') && fs.readdirSync(emptyFolder).length === 0, JSON.stringify(r.empty));
    check('B7: 画像とゴミ箱だけのフォルダを拒否し、既存の画像を変更しない', !!(r.mediaOnly && r.mediaOnly.ok === false && r.mediaOnly.error === 'no-library') && !fs.existsSync(path.join(mediaOnlyFolder, 'dot.db')) && fs.readFileSync(path.join(mediaOnlyFolder, image)).equals(imageBytes), JSON.stringify(r.mediaOnly));
    check('B8: 拒否した選択先へ設定を変更しない', !!(r.rejectedConfig && r.rejectedConfig.saveFolder === missingFolder), JSON.stringify(r.rejectedConfig));
    check('B9: 既存投稿を保持し、復帰後もタグを書き込める', r.retained === true && !!(r.write && r.write.ok === true), JSON.stringify({ retained: r.retained, write: r.write }));

    const restarted = await launch(
      configDir,
      evalSource(
        async (_waits, args) => {
          const status = await (window as any).dot.getLibraryStatus();
          const snapshot = await (window as any).dot.listPosts();
          const post = snapshot.posts.find((item: any) => item.captureId === args.captureId);
          return { status, retained: !!post, tags: post?.tags || [] };
        },
        { captureId },
      ),
    );
    check('B10: 再起動後も復帰先と既存投稿・タグの書き込みを保持する', !!(restarted.status && restarted.status.missing === false && restarted.status.path === movedLibrary) && restarted.retained === true && restarted.tags.includes('recovered'), JSON.stringify(restarted));

    fs.rmSync(tmp, { recursive: true, force: true });
  }
  const ok = results.every((r) => r.ok);
  console.log(ok ? 'LIBRARY_MISSING_TEST_PASS' : 'LIBRARY_MISSING_TEST_FAIL');
  process.exit(ok ? 0 : 1);
})();
