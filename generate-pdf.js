const puppeteer = require('puppeteer');
const path = require('path');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();

  const filePath = 'file://' + path.resolve(__dirname, 'media-pack.html');
  await page.goto(filePath, { waitUntil: 'networkidle0', timeout: 30000 });

  // Wait for Google Fonts to load
  await new Promise(r => setTimeout(r, 2500));

  await page.pdf({
    path: 'media-pack.pdf',
    format: 'A4',
    printBackground: true,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
  });

  await browser.close();
  console.log('PDF written: media-pack.pdf');
})();
