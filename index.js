const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const ExcelJS = require('exceljs');
const { db } = require('./firebaseConfig');
const { doc, setDoc, getDoc, collection, getDocs } = require('firebase/firestore');
const { getStorage, ref, uploadBytes } = require('firebase/storage');
const multer = require('multer');

puppeteer.use(StealthPlugin());

const app = express();
app.use(express.json());

const storage = getStorage();
const upload = multer();

async function getExistingDataFromDocs(docIds) {
    const allData = [];
    for (const docId of docIds) {
        const docRef = doc(db, 'scrapedData', docId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            const data = docSnap.data().data || [];
            allData.push(...data); 
        }
    }
    return allData;
}


async function getAllDocumentIds() {
    const docIds = [];
    const snapshot = await getDocs(collection(db, 'scrapedData'));
    snapshot.forEach(doc => {
        docIds.push(doc.id);
    });
    return docIds;
}


async function storeData(updatedData) {
    const docRef = doc(db, 'scrapedData', 'Akash_doc2');
    await setDoc(docRef, { data: updatedData });
}

async function scrapeData(url) {
    const browser = await puppeteer.launch({
        headless: false,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    try {
        await page.setUserAgent('Mozilla/5.0 (Linux; Android 12; SM-G991U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Mobile Safari/537.36');
        await page.goto(url, { waitUntil: 'domcontentloaded' });

        page.on('console', msg => console.log('PAGE LOG:', msg.text()));

        await page.waitForSelector('.person');

        const scrapedData = await page.evaluate(() => {
            const items = [];
            const emailSet = new Set(); // To track unique emails within the same page
            const elements = document.querySelectorAll('.person');

            elements.forEach(element => {
                const name = element.querySelector('h2 a')?.innerText.trim() || 'N/A';
                const ageText = element.querySelector('h3')?.innerText.trim() || 'N/A';
                const age = parseInt(ageText) || null;

                // Email Extraction
                const emailHeader = Array.from(element.querySelectorAll('h3'))
                    .find(h => h.innerText.includes("Associated Email Addresses"));
                const emailList = emailHeader ? Array.from(emailHeader.nextElementSibling.querySelectorAll('li'))
                    .map(el => el.innerText.trim()) : [];
                const gmailEmails = emailList.filter(email => email.includes('@gmail.com'));

                // Find phone numbers
                const phoneHeader = Array.from(element.querySelectorAll('h3'))
                    .find(h => h.innerText.includes("Associated Phone Numbers"));
                const phoneList = phoneHeader ? Array.from(phoneHeader.nextElementSibling.querySelectorAll('li a'))
                    .map(el => el.innerText.trim()) : [];

                // Only add the first unique Gmail email on the same page
                if (gmailEmails.length > 0 && !emailSet.has(gmailEmails[0].toLowerCase().trim())) {
                    emailSet.add(gmailEmails[0].toLowerCase().trim());

                    items.push({
                        name,
                        age,
                        email: gmailEmails[0] || 'N/A',
                        phone: phoneList[0] || 'N/A'
                    });
                }
            });
            return items;
        });

        return scrapedData;
    } catch (error) {
        console.error("Error scraping the data:", error);
        throw new Error("Error scraping the data: " + error.message);
    } finally {
        await browser.close();
    }
}


app.post('/scrape', async (req, res) => {
    const { url } = req.body;

    if (!url) {
        return res.status(400).json({ error: 'Please provide a valid URL.' });
    }

    try {
        console.log(`Starting to scrape data from ${url}`);
        const scrapedData = await scrapeData(url);

        if (scrapedData.length > 0) {
            console.log("Scraping successful. Fetching existing data from multiple documents...");

            // Fetch all document IDs dynamically
            const allDocIds = await getAllDocumentIds();
            const existingData = await getExistingDataFromDocs(allDocIds);
            const existingEmails = new Set(existingData.map(item => item.email ? item.email.toLowerCase().trim() : ''));

            const newData = scrapedData.filter(item =>
                item.email !== 'N/A' &&
                item.email &&
                !existingEmails.has(item.email.toLowerCase().trim()) &&
                item.age > 45 // Check for age > 45
            );

            if (newData.length > 0) {
                console.log("New unique data found. Storing updated data in Akash_doc2...");
                const akashExistingData = await getExistingDataFromDocs(['Akash_doc2']);
                const updatedData = [...akashExistingData, ...newData];
                await storeData(updatedData);

                res.json({
                    message: 'Scraping successful',
                    newEntries: newData.length,
                    totalEntries: updatedData.length
                });
            } else {
                console.log("No new unique data to add.");
                res.status(200).json({ message: 'No new unique data to add.' });
            }
        } else {
            console.log("No valid data scraped.");
            res.status(200).json({ message: 'No valid data scraped.' });
        }
    } catch (error) {
        console.error("Error during scraping route:", error);
        res.status(500).json({ error: error.message });
    }
});

// Route to download scraped data as Excel
app.get('/download', async (req, res) => {
    try {
        const scrapedData = await getExistingDataFromDocs(['Akash_doc2']);

        if (scrapedData.length === 0) {
            return res.status(404).json({ error: 'No data found' });
        }

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Akash Data');
        worksheet.columns = [
            { header: 'Name', key: 'name', width: 30 },
            { header: 'Age', key: 'age', width: 10 },
            { header: 'Email', key: 'email', width: 30 },
            { header: 'Phone', key: 'phone', width: 20 }
        ];

        scrapedData.forEach(data => worksheet.addRow(data));

        res.setHeader('Content-Disposition', 'attachment; filename="scraped_data.xlsx"');
        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        console.error("Error during Excel download:", error);
        res.status(500).json({ error: error.message });
    }
});

// Route to upload a modified Excel file
app.post('/upload', upload.single('file'), async (req, res) => {
    try {
        const fileBuffer = req.file.buffer;
        const storageRef = ref(storage, 'scraped_data.xlsx');
        await uploadBytes(storageRef, fileBuffer);
        res.json({ message: 'File uploaded successfully' });
    } catch (error) {
        console.error("Error during file upload:", error);
        res.status(500).json({ error: error.message });
    }
});

// Default route
app.get('/', (req, res) => {
    res.status(200).json('Hello World!');
});

// Start the server
const PORT = 3011;
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
