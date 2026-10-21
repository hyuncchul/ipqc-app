# Local OCR dependencies

These unmodified files run OCR inside the user's browser. Photos are not sent to an OCR service. The application requests only these same-origin program/model files; the model may be cached by Tesseract in IndexedDB.

- **Tesseract.js 6.0.1**: `tesseract.min.js`, `worker.min.js`. Source/package: https://www.npmjs.com/package/tesseract.js/v/6.0.1 and https://github.com/naptha/tesseract.js/tree/v6.0.1 . Apache-2.0, license in `tesseract-LICENSE`; bundled dependency notices in `tesseract.min.js.LICENSE.txt` and `worker.min.js.LICENSE.txt`.
- **tesseract.js-core 6.0.0**: `tesseract-core-lstm.wasm.js`, `tesseract-core-simd-lstm.wasm.js`. These contain their WebAssembly payloads. Source/package: https://www.npmjs.com/package/tesseract.js-core/v/6.0.0 and https://github.com/naptha/tesseract.js-core . Apache-2.0, license in `tesseract-core-LICENSE`. Only LSTM mode is enabled; both SIMD and non-SIMD variants are supplied.
- **@tesseract.js-data/eng 1.0.0**, `4.0.0_best_int/eng.traineddata.gz`. Package: https://www.npmjs.com/package/@tesseract.js-data/eng/v/1.0.0 . English model repository: https://github.com/naptha/tessdata and upstream https://github.com/tesseract-ocr/tessdata_best . Model Apache-2.0 license in `eng-model-LICENSE` (the npm packaging metadata separately lists MIT).

The OCR engine reads Latin letters and digits in this LTC form. It does not claim Chinese or multilingual OCR. The application's UI languages are separate from the OCR model. Extracted values must be reviewed against the photo before use.
