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

const docName = "Akash_doc_0412"

// Function to get existing data from Firestore documents+`
async function getExistingDataFromDocs(docIds) {
    const allDataPromises = docIds.map(async (docId) => {
        const docRef = doc(db, 'scrapped_data_automate', docId);
        const docSnap = await getDoc(docRef);
        return docSnap.exists() ? docSnap.data().data || [] : [];
    });

    const allData = await Promise.all(allDataPromises);
    return allData.flat(); // Merge all arrays into a single array
}

async function getExistingDataFromDoc(docName) {
    const docRef = doc(db, 'scrapped_data_automate', docName);
    const docSnap = await getDoc(docRef);
    return docSnap.exists() ? docSnap.data().data || [] : [];
}

// Function to get all document IDs from Firestore
async function getAllDocumentIds() {
    const snapshot = await getDocs(collection(db, 'scrapped_data_automate'));
    return snapshot.docs.map(doc => doc.id);
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
        const debugLogs = []; // Array to collect logs
        const elements = document.querySelectorAll('.person');

        debugLogs.push(`Total persons found: ${elements.length}`);

        elements.forEach((person, index) => {
            const personData = {};

            // Extract Name
            const nameElement = person.querySelector('h2 a');
            personData.name = nameElement ? nameElement.innerText.trim() : 'N/A';
            debugLogs.push(`Person ${index + 1}: Name: ${personData.name}`);

            // Extract Age
            const ageText = person.querySelector('h3')?.innerText.trim() || 'N/A';
            personData.age = parseInt(ageText) || null;
            debugLogs.push(`Person ${index + 1}: Age: ${personData.age}`);

            // Search for "other email addresses" in all <span> elements
            const spans = Array.from(person.querySelectorAll('span'));
            const matchingSpan = spans.find(span => span.innerText.toLowerCase().includes('other email addresses'));

            if (matchingSpan) {
                debugLogs.push(`Person ${index + 1}: Found matching span with text: ${matchingSpan.innerText}`);

                try {
                    // Simulate hovering or clicking on the span
                    matchingSpan.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
                    debugLogs.push(`Person ${index + 1}: Hovered over the matching span.`);
                } catch (error) {
                    debugLogs.push(`Person ${index + 1}: Error interacting with matching span - ${error.message}`);
                }

                // Ensure tooltip is visible
                const tooltipTextSpan = matchingSpan.querySelector('.tooltiptext');
                if (tooltipTextSpan) {
                    tooltipTextSpan.style.display = 'block'; // Force visibility
                    const tooltipContent = tooltipTextSpan.innerHTML.trim(); // Use innerHTML to capture raw HTML
                    debugLogs.push(`Person ${index + 1}: Tooltip content (innerHTML): ${tooltipContent}`);

                    // Extract emails from the HTML
                    const emails = tooltipContent
                        .split(/<br\s*\/?>/) // Split by <br> or <br/>
                        .map(email => email.trim()) // Trim whitespace
                        .filter(email => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)); // Validate email format

                    personData.emails = emails;
                    debugLogs.push(`Person ${index + 1}: Extracted emails: ${emails.join(', ')}`);
                } else {
                    debugLogs.push(`Person ${index + 1}: Tooltip text not found or is empty.`);
                    personData.emails = [];
                }
            } else {
                debugLogs.push(`Person ${index + 1}: No matching span found.`);
                personData.emails = [];
            }

            // Add to results only if age > 45 and emails are present
            if (personData.age && personData.age > 45 && personData.emails.length > 0) {
                items.push(personData);
                debugLogs.push(`Person ${index + 1}: Added to results.`);
            } else {
                debugLogs.push(`Person ${index + 1}: Not added to results (missing emails or age <= 45).`);
            }
        });

        return { items, debugLogs }; // Return both data and logs
    });
}

async function scrapeDataWithSelenium(url) {
    let driver;
    let scrapedData = [];
    let attempt = 0;
    const maxAttempts = 3; 

    while (attempt < maxAttempts) {
        try {
            console.log(`Attempt ${attempt + 1}: Starting browser for URL: ${url}`);
            driver = await new Builder().forBrowser('chrome').build();

            // Step 1: Navigate to the main page that contains the names list
            await driver.get(url);
            await handleAgreementModal(driver);

            // Step 2: Get all <li> elements that contain the name links
            let nameElements = await driver.findElements(By.css('#names-list li a'));

            console.log("Names list found:", nameElements.length);

            for (let i = 0; i < nameElements.length; i++) {
                const personLink = nameElements[i];

                // Attempt to click the link with retry
                await clickElementWithRetry(driver, personLink);

                // Wait for the detail page to load
                await driver.wait(until.elementLocated(By.css('h2')), 10000);
                console.log(`Clicked on name ${i + 1}, now scraping data...`);

                // Step 4: Scrape relevant data on the person's page
                const { items: personData, debugLogs } = await scrapeDataOnPage(driver);

                // Log debug information
                console.log(`Debug logs for person ${i + 1}:\n`, debugLogs.join('\n'));

                if (personData.length > 0) {
                    scrapedData.push(...personData);
                    console.log(`Data for person ${i + 1} scraped and added.`);
                } else {
                    console.log(`No data found for person ${i + 1}.`);
                }

                // Step 5: Navigate back to the list page
                await driver.navigate().back();
                await driver.wait(until.elementLocated(By.css('#names-list li a')), 10000); // Ensure the list is loaded
                await new Promise(resolve => setTimeout(resolve, 1000)); // Pause for a short moment

                // Re-fetch the name elements after navigating back
                nameElements = await driver.findElements(By.css('#names-list li a')); // Reassign
            }

            return scrapedData; // Return data if scraping succeeds
        } catch (error) {
            console.error(`Error during scraping attempt ${attempt + 1}:`, error);
                await driver.quit(); // Close the browser instance
            attempt++;
            console.log(`Restarting browser... (Attempt ${attempt} of ${maxAttempts})`);
        } finally{
            await driver.quit(); // Close the browser instance
        }
    }

    throw new Error(`Failed to scrape data after ${maxAttempts} attempts`);
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


// Function to store new data in Firestore
async function storeData(newData) {
    const docRef = doc(db, 'scrapped_data_automate', docName);

    try {
        // Get all document IDs in the collection
        const docIds = await getAllDocumentIds();

        // Fetch all existing data using your existing function
        const existingData = await getExistingDataFromDocs(docIds);

        // Merge existing data with new data and prevent duplicates by email
        const updatedData = [...existingData,...newData];


        // Save the updated data back to a single document in Firestore
        await setDoc(docRef, { data: updatedData }, { merge: true }); 
        return updatedData;
    } catch (error) {
        console.error("Error storing data in Firestore:", error);
        throw error;
    }
}




// Route to scrape data and store it in Firestore
app.post('/scrape', async (req, res) => {
    const { baseUrl, startPage = 1, endPage = 100 } = req.body;

    if (!baseUrl || !baseUrl.includes('{page}')) {
        return res.status(400).json({ error: 'Please provide a valid base URL with a placeholder {page}.' });
    }

    try {
        let scrapedData = [];
        for (let page = startPage; page <= endPage; page++) {
            const url = baseUrl.replace('{page}', page); // Replace {page} in the base URL with the current page number

            const alreadyProcessed = await isUrlAlreadyProcessed(url);
            if (alreadyProcessed) {
                console.log(`URL already processed: ${url}. Skipping.`);
                continue;
            }

            console.log(`Processing URL: ${url}`);
            const pageData = await scrapeDataWithSelenium(url);

            if (pageData.length > 0) {
                scrapedData.push(...pageData);
                await saveUrl(url); // Mark URL as processed
            }
        }

        if (scrapedData.length > 0) {
            const updatedData = await storeData(scrapedData); // Store unique data across all documents
            console.log("Scrapping complete for ",url);
            return res.json({
                message: `Scraping successful for ${url} `,
                newEntries: scrapedData.length,
                totalEntries: updatedData.length
            });
           
        } else {
            return res.status(200).json({ message: 'No new data found.', data: scrapedData });
        }
    } catch (error) {
        console.error("Error during scraping:", error);
        return res.status(500).json({ error: 'An error occurred while scraping the data.' });
    }
});

// Route to download the Excel file
app.get('/download', async (req, res) => {
    const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Scraped Data');

    // Set column headers
    worksheet.columns = [
        { header: 'Email', key: 'email', width: 100 },
        { header: 'Name', key: 'name', width: 30 },
        { header: 'Age', key: 'age', width: 10 },
        { header: 'Phone', key: 'phone', width: 20 },
    ];

    try {
        // Fetch data to be written in the Excel file
        const existingData = await getExistingDataFromDoc(docName);

        existingData.forEach(person => {
            worksheet.addRow({
                email: person.emails,
                name: person.name,
                age: person.age,
                phone: person.phone,
            });
        });

        // Write the Excel file to a buffer
        const buffer = await workbook.xlsx.writeBuffer();

        // Set headers for the response
        res.set({
            'Content-Disposition': `attachment; filename="${docName}.xlsx"`,
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Length': buffer.length
        });

        // Send the buffer in the response
        res.send(buffer);
    } catch (error) {
        console.error("Error downloading Excel file:", error);
        return res.status(500).json({ error: 'An error occurred while downloading the file.' });
    }
});


// Route to download the Excel file with only emails
app.get('/downloademails', async (req, res) => {
    const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Emails Only');

    // Set column headers for the worksheet
    worksheet.columns = [
        { header: 'Emails', key: 'emails', width: 50 },
        { header: 'Name', key: 'name', width: 30 }
    ];

    try {
        // Fetch data to be written in the Excel file
        const existingData = await getExistingDataFromDoc(docName);

        existingData.forEach(person => {
            if (person.emails && person.emails.length > 0) {
                person.emails.forEach(email => {
                    worksheet.addRow({
                        emails: email,
                        name: person.name,
                    });
                });
            } else {
                worksheet.addRow({
                    emails: 'No emails found',
                    name: person.name,
                });
            }
        });

        // Write the Excel file to a buffer
        const buffer = await workbook.xlsx.writeBuffer();

        // Set headers for the response
        res.set({
            'Content-Disposition': `attachment; filename="emails_only_${timestamp}.xlsx"`,
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Length': buffer.length
        });

        // Send the buffer in the response
        res.send(buffer);
    } catch (error) {
        console.error("Error downloading emails Excel file:", error);
        return res.status(500).json({ error: 'An error occurred while downloading the emails file.' });
    }
});


// Start the server
const PORT = process.env.PORT || 3099;
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}/download`);
    console.log(`Server is running on http://localhost:${PORT}/downloademails`);
});
