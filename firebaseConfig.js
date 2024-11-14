const { initializeApp } = require('firebase/app');
const { getFirestore } = require('firebase/firestore');
const { getStorage } = require('firebase/storage');

const firebaseConfig = {
  apiKey: "AIzaSyBbhnPcFfl_J627uUi3xAB7140NWHDVjSw",
  authDomain: "scrapper-2f59c.firebaseapp.com",
  projectId: "scrapper-2f59c",
  storageBucket: "scrapper-2f59c.appspot.com",
  messagingSenderId: "971733365816",
  appId: "1:971733365816:web:659b689b1699d7e64622cd"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app); 

module.exports = { db, storage };
