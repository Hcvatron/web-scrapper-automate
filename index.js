const express = require('express');
const { Builder, By, until } = require('selenium-webdriver');
const ExcelJS = require('exceljs');
const multer = require('multer');
const { db } = require('./firebaseConfig');
const { doc, setDoc, getDoc, collection, getDocs } = require('firebase/firestore');
const { getStorage } = require('firebase/storage');

// Initialize Express
const app = express();
app.use(express.json());

// Firebase Storage setup
const storage = getStorage();
const upload = multer();

const docName = "Akash_doc_1510"

// Function to get existing data from Firestore documents
async function getExistingDataFromDocs(docIds) {
    const allDataPromises = docIds.map(async (docId) => {
        const docRef = doc(db, 'scrapped_data_automate', docId);
        const docSnap = await getDoc(docRef);
        return docSnap.exists() ? docSnap.data().data || [] : [];
    });

    const allData = await Promise.all(allDataPromises);
    return allData.flat(); // Merge all arrays into a single array
}

// Function to get all document IDs from Firestore
async function getAllDocumentIds() {
    const snapshot = await getDocs(collection(db, 'scrapped_data_automate'));
    return snapshot.docs.map(doc => doc.id);
}

// Function to store new data in Firestore
async function storeData(updatedData) {
    const docRef = doc(db, 'scrapped_data_automate', docName);
    await setDoc(docRef, { data: updatedData });
}

// Function to handle the agreement modal
async function handleAgreementModal(driver) {
    try {
        const modal = await driver.wait(until.elementLocated(By.id('warning-modal')), 20000);
        if (await modal.isDisplayed()) {
            const checkbox = await driver.findElement(By.id('security-check'));
            await driver.wait(until.elementIsVisible(checkbox), 20000);
            const isChecked = await checkbox.isSelected();
            if (!isChecked) {
                await checkbox.click();
            }
            console.log("Checkbox clicked and agreement accepted.");
        }
        // Wait for the modal to disappear
        await driver.wait(until.stalenessOf(modal), 20000);
    } catch (error) {
        console.error("Error handling the agreement modal:", error);
    }
}

// Function to scroll and click an element with retries
async function clickElementWithRetry(driver, element, retries = 3) {
    while (retries > 0) {
        try {
            await driver.executeScript("arguments[0].scrollIntoView(true);", element);
            await driver.wait(until.elementIsVisible(element), 10000);
            await element.click();
            return; // Click was successful
        } catch (error) {
            console.error(`Click failed, retries left: ${retries}`, error);
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait before retrying
            retries--;
        }
    }
    throw new Error('Element not clickable after multiple attempts');
}


// Function to scrape data for a single page
async function scrapeDataOnPage(driver) {
    return driver.executeScript(() => {
        const items = [];
        const elements = document.querySelectorAll('.person');

        elements.forEach(element => {
            const name = element.querySelector('h2 a')?.innerText.trim() || 'N/A';
            const ageText = element.querySelector('h3')?.innerText.trim() || 'N/A';
            const age = parseInt(ageText) || null;

            // Proceed only if age is greater than 45
            if (age && age > 45) {
                // Email Extraction
                const emailHeader = Array.from(element.querySelectorAll('h3'))
                    .find(h => h.innerText.includes("Associated Email Addresses"));
                const emailList = emailHeader ? Array.from(emailHeader.nextElementSibling.querySelectorAll('li'))
                    .map(el => el.innerText.trim()) : [];

                // Filter emails based on specific domains and pick the first valid one
                let email = emailList.find(email =>
                    email.includes('@aol.') ||
                    email.includes('@yahoo.') ||
                    email.includes('@comcast.') ||
                    email.includes('@Hotmail.')
                );
                
                // If no email found from the specified domains, look for a gmail.com email
                if (!email) {
                    email = emailList.find(email => email.includes('@gmail.com'));
                }

                // Skip if no valid email is found
                if (!email) return;

                // Find phone numbers
                const phoneHeader = Array.from(element.querySelectorAll('h3'))
                    .find(h => h.innerText.includes("Associated Phone Numbers"));
                const phoneList = phoneHeader ? Array.from(phoneHeader.nextElementSibling.querySelectorAll('li'))
                    .map(el => el.innerText.trim()) : [];

                // Extracting addresses
                const lastKnownAddressHeader = Array.from(element.querySelectorAll('h3'))
                    .find(h => h.innerText.includes("Last Known Address"));
                const lastKnownAddress = lastKnownAddressHeader ? lastKnownAddressHeader.nextElementSibling.innerText.trim() : 'N/A';

                const pastAddressHeader = Array.from(element.querySelectorAll('h3'))
                    .find(h => h.innerText.includes("Past Addresses"));
                const pastAddressList = pastAddressHeader ? Array.from(pastAddressHeader.nextElementSibling.nextElementSibling.querySelectorAll('li'))
                    .map(el => el.innerText.trim()) : [];

                items.push({
                    name,
                    age,
                    email, // Only the first valid email
                    phone: phoneList[0] || 'N/A',
                    lastKnownAddress, // Add last known address
                    pastAddresses: pastAddressList, // Add past addresses as an array
                });
            }
        });
        return items;
    });
}






// Main scraping function
async function scrapeDataWithSelenium(url) {
    let driver = await new Builder().forBrowser('chrome').build();
    let scrapedData = [];

    try {
        // Step 1: Navigate to the main page that contains the names list
        await driver.get(url);
        await handleAgreementModal(driver);

        // Step 2: Get all <li> elements that contain the name links
        let nameElements = await driver.findElements(By.css('#names-list li a'));

        for (let i = 0; i < nameElements.length; i++) {
            const personLink = nameElements[i];

            // Attempt to click the link with retry
            await clickElementWithRetry(driver, personLink);
            
            // Wait for the detail page to load
            await driver.wait(until.elementLocated(By.css('h2')), 10000);
            console.log("Clicked name -->");

            // Step 4: Scrape relevant data on the person's page
            const personData = await scrapeDataOnPage(driver);
            if (personData.length > 0) {
                scrapedData.push(...personData);
                console.log("Data pushed -->");
            }

            // Step 5: Navigate back to the list page
            await driver.navigate().back();
            await driver.wait(until.elementLocated(By.css('#names-list li a')), 10000);
            await new Promise(resolve => setTimeout(resolve, 1000)); // Adjust delay as necessary

            // Re-fetch the name elements after navigating back
            nameElements = await driver.findElements(By.css('#names-list li a'));
        }

        return scrapedData;
    } catch (error) {
        console.error("Error scraping data:", error);
    } finally {
        await driver.quit();
    }
}

// Function to check if a URL is already processed
async function isUrlAlreadyProcessed(url) {
    const urlDocRef = doc(db, 'scrapped_data_automate', 'url_history');
    const urlDocSnap = await getDoc(urlDocRef);

    if (urlDocSnap.exists()) {
        const processedUrls = urlDocSnap.data().urls || [];
        return processedUrls.includes(url); 
    }
    return false;
}

// Function to save the URL to the Firestore document after scraping
async function saveUrl(url) {
    const urlDocRef = doc(db, 'scrapped_data_automate', 'url_history');
    const urlDocSnap = await getDoc(urlDocRef);

    if (urlDocSnap.exists()) {
        const existingUrls = urlDocSnap.data().urls || [];
        await setDoc(urlDocRef, { urls: [...existingUrls, url] }); 
    } else {
        await setDoc(urlDocRef, { urls: [url] });
    }
}


// Route to scrape data and store it in Firestore
app.post('/scrape', async (req, res) => {
    const { url } = req.body;

    if (!url) {
        return res.status(400).json({ error: 'Please provide a valid URL.' });
    }

    try {

        const alreadyProcessed = await isUrlAlreadyProcessed(url);
        if (alreadyProcessed) {
            return res.status(200).json({ message: 'URL has already been checked. Skipping scrape.' });
        }


        const scrapedData = await scrapeDataWithSelenium(url);
        if (scrapedData.length > 0) {
            const allDocIds = await getAllDocumentIds();
            const existingData = await getExistingDataFromDocs(allDocIds);


            // Extract emails from the existing data for comparison
            const existingEmails = new Set(existingData.map(item => item.email));

            // Filter out any scraped data where the email already exists
            const newData = scrapedData.filter(item => !existingEmails.has(item.email));

            if (newData.length > 0) {
                // Get current data from Firestore (doc2) and append only the new data
                const currentData = await getExistingDataFromDocs([docName]);
                const updatedData = [...currentData, ...newData]; // Append new, non-duplicate data
                await storeData(updatedData);

                await saveUrl(url);

                res.json({
                    message: 'Scraping successful',
                    newEntries: newData.length, // Number of new entries added
                    totalEntries: updatedData.length // Total entries after update
                });
            } else {
                await saveUrl(url);
                res.status(200).json({ message: 'No new unique data to add.' });
            }
        } else {
            res.status(200).json({ message: 'No valid data scraped.' });
        }
    } catch (error) {
        console.error('Error in /scrape:', error);
        res.status(500).json({ error: error.message });
    }
});



// Route to download scraped data as Excel
app.get('/download', async (req, res) => {
    try {
        const scrapedData = await getExistingDataFromDocs([docName]);

        if (scrapedData.length === 0) {
            return res.status(404).send('No data available to download.');
        }

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Scraped Data');

        worksheet.columns = [
            { header: 'Name', key: 'name' },
            { header: 'Age', key: 'age' },
            { header: 'Email', key: 'email' },
            { header: 'Phone', key: 'phone' },
            { header: 'Addresses', key: 'addresses' },
        ];

        scrapedData.forEach(person => {
            worksheet.addRow({
                name: person.name,
                age: person.age,
                email: person.email,
                phone: person.phone,
                addresses: person.addresses.join(', '),
            });
        });

        const buffer = await workbook.xlsx.writeBuffer();
        const timestamp = new Date().toISOString().replace(/[-:.]/g, '');
        res.set({
            'Content-Disposition': `attachment; filename=scraped_data_${timestamp}.xlsx`,
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });

        res.send(buffer);
    } catch (error) {
        res.status(500).send('Error generating Excel file.',error);
    }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
