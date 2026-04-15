import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { readFileSync } from 'fs';

const serviceAccount = JSON.parse(readFileSync('./service-account.json', 'utf8'));

initializeApp({
  credential: cert(serviceAccount)
});

const ADMIN_EMAIL = 'admin@edgeos.com';
const ADMIN_PASSWORD = 'admin123';

async function setupAdminUser() {
  const auth = getAuth();
  
  try {
    const userRecord = await auth.getUserByEmail(ADMIN_EMAIL);
    await auth.updateUser(userRecord.uid, {
      password: ADMIN_PASSWORD
    });
    console.log(`Successfully updated admin user: ${ADMIN_EMAIL}`);
  } catch (error) {
    if (error.code === 'auth/user-not-found') {
      await auth.createUser({
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD
      });
      console.log(`Successfully created admin user: ${ADMIN_EMAIL}`);
    } else {
      console.error('Error:', error.message);
      process.exit(1);
    }
  }
}

setupAdminUser();
