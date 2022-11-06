const {
  test
} = require('@playwright/test');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

test('generate snapshots', async ({
  page
}) => {

  await page.goto('http://localhost:5174/');

  // Sample IIIF manifests to try:

  // Life of Samuel Johnson: https://iiif.lib.harvard.edu/manifests/drs:433026349
  // Type specimen: https://iiif.lib.harvard.edu/manifests/drs:47180996
  // Anatomy textbook: https://iiif.lib.harvard.edu/manifests/drs:5735821
  // Antarctic sketches: https://iiif.lib.harvard.edu/manifests/drs:8906436
  // Music: https://iiif.lib.harvard.edu/manifests/drs:47248995
  // Nothing to Wear: https://iiif.lib.harvard.edu/manifests/drs:47608959
  // Birds of Great Britain: https://iiif.lib.harvard.edu/manifests/drs:22019913
  // Lettie Lane illustrations: https://iiif.lib.harvard.edu/manifests/drs:47752428
  // Flowers: https://iiif.lib.harvard.edu/manifests/drs:45827046
  // Caldecott's: https://iiif.lib.harvard.edu/manifests/drs:24953785
  // Menagerie: https://iiif.lib.harvard.edu/manifests/drs:50796706
  // Emily Dickenson: https://iiif.lib.harvard.edu/manifests/drs:43369310
  await page.locator('input[name="url"]').fill('https://iiif.lib.harvard.edu/manifests/drs:43369310');
  await page.locator('input[name="url"]').click();
  await page.locator('input[name="url"]').press('Enter');


  for (let i = 0; i < 100; i++) {
    await delay(4000);
    console.log(`screenshotting ${i}`)
    await page.screenshot({
      path: `output/screenshot-${i}.png`,
      fullPage: true,
      /* You will want to fuss with these given a particular book to get the best clipping */
      clip: {
        x: 130,
        y: 100,
        width: 1300,
        height: 2000
      }
    })
    await page.getByRole('button', {
      name: 'Reveal next page'
    }).click();
  }


})