// Sample data shared by the landing page's product replicas.
import { ShieldCheck, TrendingUp, Handshake, BookOpen, Activity } from 'lucide-react';

export const money = (n) => '₹ ' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const AGENTS = [
    { name: 'Compliance and Deadline', desc: 'GST, TDS and contract dates', icon: ShieldCheck, on: true, freq: 'Daily' },
    { name: 'Business Intelligence', desc: 'Weekly summary of the numbers', icon: TrendingUp, on: true, freq: 'Weekly' },
    { name: 'Deal Intelligence', desc: 'Leads that need a nudge', icon: Handshake, on: true, freq: 'Daily' },
    { name: 'Internal Knowledge', desc: 'Answers from your library', icon: BookOpen, on: false, freq: 'On ask' },
    { name: 'Operations Monitoring', desc: 'Stalled tasks and overruns', icon: Activity, on: false, freq: 'On ask' },
];
