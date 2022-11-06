# A Letter Groove

Given a URL of an IIIF manifest pointing at a series of scanned book pages, produce a new book that cuts out words revealing the pages beneath.




The webapp can be used directly to view page output at https://lizadaly.github.io/a-letter-groove/.

# Local usage

You probably don't want to bother!

To generate PDF book output, you'll need to install and run it yourself. It will install Vite to run the local webserver, and Playwright to run the browser automation to walk through an entire book. TesseractJS is imported directly from the HTML.

```bash
npm install

# Configure `playwright.config.js` to capture your IIIF manifest and tweak the PDF output

# Then run the browser automation
npm run test
```

Individual screenshots will end up in `output/`. The simplest way to turn them into a PDF is with ImageMagick:

```
cd output/
convert *.png your-file.pdf
```


