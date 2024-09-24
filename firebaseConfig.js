const { initializeApp } = require('firebase/app');
const { getFirestore } = require('firebase/firestore');
const { getStorage } = require('firebase/storage');

const firebaseConfig = {
    apiKey: "AIzaSyBV5Bz_jY6C4GVoCH_Esg-LGrrFuG64NZo",
    authDomain: "scrapper-9beb2.firebaseapp.com",
    projectId: "scrapper-9beb2",
    storageBucket: "scrapper-9beb2.appspot.com",
    messagingSenderId: "244184566873",
    appId: "1:244184566873:web:73bf14432cab9c40daf548",
    measurementId: "G-K00Q86M2G9"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app); 

module.exports = { db, storage };
