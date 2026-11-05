// TEMPORARY diagnostic for the CI gizmo failure. Not to be merged.
import { test } from '@playwright/test';

test('diag: renderer', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  const renderer = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return 'no webgl2';
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });
  console.log('[diag] renderer', renderer);
});
