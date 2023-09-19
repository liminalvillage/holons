import axios from 'axios';
import bwipjs from 'bwip-js';
import sharp from 'sharp';
import { Image, createCanvas } from 'canvas';
import Quagga from 'quagga'; // Barcode decoder

class BarcodeScanner {
  async scanImage(imagePath) {
    try {
      // Decode image to get barcode
      const barcode = await this.getBarcodeFromImage(imagePath);
  
      // Get book details from the barcode
      const bookInfo = await this.scan(barcode);
  
      return bookInfo;
    } catch(err) {
      console.error(err.message);
      throw err;
    }
  }
  
  async getBarcodeFromImage(imagePath) {
    const image = sharp(imagePath);
    const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  
    const canvas = createCanvas(info.width, info.height);
    const ctx = canvas.getContext('2d');
  
    const img = new Image();
    img.src = data;
  
    ctx.drawImage(img, 0, 0, info.width, info.height);
  
    return new Promise((resolve, reject) => {
      Quagga.decodeSingle({
        decoder: {
          readers: ["ean_reader"] // this would be the type of barcode you're interested in
        },
        locate: true,
        src: canvas.toDataURL(),
        numOfWorkers: 0, // needs to be 0 when used within node
        inputStream: {
          size: 800
        },
      }, (result) => {
        if(result && result.codeResult) {
          console.log("result", result.codeResult.code);
          resolve(result.codeResult.code);
        } else {
          console.log("not detected");
          reject(new Error('Barcode not detected'));
        }
      });
    });
  }
    async scan(barcode) {
        try {
            // Verify if the barcode is correct
            const verify = bwipjs.verify({
                bcid:  'isbn',       
                text:  barcode,     
            });

            if(!verify) {
                throw new Error("Invalid Barcode");
            }

            // Get book information from Google Books API
            const response = await axios.get(`https://www.googleapis.com/books/v1/volumes?q=isbn:${barcode}`);

            if(response.data.totalItems === 0) {
                throw new Error("Book Not Found");
            }

            const book = response.data.items[0].volumeInfo;
            const price = response.data.items[0].saleInfo.listPrice.amount;
            const currency = response.data.items[0].saleInfo.listPrice.currencyCode;

            return { 
                title: book.title, 
                authors: book.authors, 
                price: `${price} ${currency}` 
            };
        } catch(err) {
            console.error(err.message);
            throw err;
        }
    }
}

export default BarcodeScanner;