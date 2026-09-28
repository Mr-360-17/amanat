// Amanat frontend. One app, four entry points by URL, each for a different person:
//   /                 Ramesh (owner)            - needs the owner key
//   /circle/<token>   a trusted contact's phone - token from their SMS
//   /family/<token>   a beneficiary's phone     - token sent only at release
//   /demo             presenter page for the live demo (owner key)
import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import './extra.css';
import OwnerApp from './OwnerApp.jsx';
import ContactApp from './ContactApp.jsx';
import FamilyApp from './FamilyApp.jsx';
import DemoApp from './DemoApp.jsx';
import { ToastProvider } from './ui.jsx';

function Router() {
  const [, section, token] = location.pathname.split('/');
  if (section === 'circle' && token) return <ContactApp token={token} />;
  if (section === 'family' && token) return <FamilyApp token={token} />;
  if (section === 'demo') return <DemoApp />;
  return <OwnerApp />;
}

createRoot(document.getElementById('root')).render(<ToastProvider><Router /></ToastProvider>);
