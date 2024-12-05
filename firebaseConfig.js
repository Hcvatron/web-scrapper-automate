const { initializeApp } = require('firebase/app');
const { getFirestore } = require('firebase/firestore');
const { getStorage } = require('firebase/storage');

const firebaseConfig = {
  apiKey: "AIzaSyB_998ljS6FzuM1ro0hc6hsrkFRtFlSWM8",
  authDomain: "data-bee-6917d.firebaseapp.com",
  projectId: "data-bee-6917d",
  storageBucket: "data-bee-6917d.firebasestorage.app",
  messagingSenderId: "536351191389",
  appId: "1:536351191389:web:ba8af013fdc5c9405cb8b4",
  measurementId: "G-LQDJ1BRZQ3"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app); 

module.exports = { db, storage };
