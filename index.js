const express = require('express');
const admin = require('firebase-admin');
const axios = require('axios');
const fs = require('fs');

const app = express();
app.use(express.json());

const SECURITY_KEY = process.env.SECURITY_KEY;
const CHECK_INTERVAL = 30000; // 30 seconds

const API_CONFIG = {
    baseUrl: 'https://app.ghazaresan.com/api/',
    endpoints: {
        auth: 'Authorization/Authenticate',
        orders: 'Orders/GetOrders'
    }
};

// Initialize Firebase Admin
const serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
   const projectId = process.env.FIREBASE_PROJECT_ID;
});

// Store active users and their check intervals
const activeUsers = new Map();

// Handle GitHub repository dispatch events
if (process.env.GITHUB_EVENT_PATH) {
    const eventPayload = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    console.log('Event received:', eventPayload);
    
    if (eventPayload.event_type === 'register') {
        const { username, password, fcmToken } = eventPayload.client_payload;
        handleRegistration(username, password, fcmToken);
    } else if (eventPayload.event_type === 'unregister') {
        const { fcmToken } = eventPayload.client_payload;
        handleUnregistration(fcmToken);
    }
}

async function handleRegistration(username, password, fcmToken) {
    console.log('Processing registration for:', username);
    try {
        const authResponse = await authenticateUser(username, password);
        if (!authResponse.success) {
            console.log('Authentication failed for:', username);
            return;
        }

        activeUsers.set(fcmToken, {
            username,
            password,
            lastOrderId: null,
            checkInterval: null
        });
        
        startChecking(fcmToken);
        console.log('Registration successful for:', username);
    } catch (error) {
        console.error('Registration error:', error);
    }
}

function handleUnregistration(fcmToken) {
    console.log('Processing unregistration for token:', fcmToken);
    const user = activeUsers.get(fcmToken);
    
    if (user && user.checkInterval) {
        clearInterval(user.checkInterval);
    }
    
    activeUsers.delete(fcmToken);
    console.log('Unregistration successful');
}

async function authenticateUser(username, password) {
    try {
        const authUrl = `${API_CONFIG.baseUrl}${API_CONFIG.endpoints.auth}`;
        const response = await axios.post(authUrl, {
            username,
            password
        }, {
            headers: {
                'Accept': 'application/json, text/plain, */*',
                'Content-Type': 'application/json',
                'securitykey': SECURITY_KEY,
                'Origin': 'https://portal.ghazaresan.com',
                'Referer': 'https://portal.ghazaresan.com/'
            }
        });
        
        return { success: true, token: response.data.Token };
    } catch (error) {
        console.error('Authentication error:', error);
        return { success: false };
    }
}

async function checkOrders(username, password, fcmToken) {
    console.log('Checking orders for:', username);
    const user = activeUsers.get(fcmToken);
    if (!user) return;

    try {
        const auth = await authenticateUser(username, password);
        if (!auth.success) return;

        const ordersUrl = `${API_CONFIG.baseUrl}${API_CONFIG.endpoints.orders}`;
        const ordersResponse = await axios.post(ordersUrl, {
            authorizationCode: auth.token,
            securityKey: SECURITY_KEY
        }, {
            headers: {
                'Accept': 'application/json, text/plain, */*',
                'Content-Type': 'application/json',
                'authorizationcode': auth.token,
                'securitykey': SECURITY_KEY,
                'Origin': 'https://portal.ghazaresan.com',
                'Referer': 'https://portal.ghazaresan.com/'
            }
        });

        const newOrders = ordersResponse.data.filter(order => order.Status === 0);
        
        if (newOrders.length > 0) {
            console.log('New orders found:', newOrders.length);
            await admin.messaging().send({
                token: fcmToken,
                notification: {
                    title: 'New Orders Available',
                    body: `You have ${newOrders.length} new order(s) waiting`
                },
                data: {
                    orderCount: newOrders.length.toString()
                }
            });
        }
    } catch (error) {
        console.error('Order check error:', error);
    }
}

function startChecking(fcmToken) {
    const user = activeUsers.get(fcmToken);
    if (!user) return;

    if (user.checkInterval) {
        clearInterval(user.checkInterval);
    }

    user.checkInterval = setInterval(() => {
        checkOrders(user.username, user.password, fcmToken);
    }, CHECK_INTERVAL);

    activeUsers.set(fcmToken, user);
    console.log('Order checking started for token:', fcmToken);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
