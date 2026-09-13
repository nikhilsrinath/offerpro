import React, { useState } from 'react';
import { Archive, Download, RefreshCw } from 'lucide-react';
import { Page, Toolbar, Seg, Table, Tr, Td, Status, Btn, Empty, Muted } from '../ui/edge';

// Batch jobs are not persisted yet, so the history is always empty for now.
const MOCK_HISTORY = [];

const FILTERS = ['All', 'Offer Letters', 'Certificates', 'Team Import'];

export default function BulkHistory() {
    const [filter, setFilter] = useState('All');

    const filteredHistory = MOCK_HISTORY.filter((h) => filter === 'All' || h.type === filter);

    return (
        <Page>
            <Toolbar right={<Muted>Past batch jobs, their logs and their files</Muted>}>
                <Seg label="Job type" value={filter} onChange={setFilter} options={FILTERS.map((f) => ({
                    id: f, label: f, count: f === 'All' ? MOCK_HISTORY.length : MOCK_HISTORY.filter((h) => h.type === f).length,
                }))} />
            </Toolbar>

            <Table
                cols={[
                    { key: 'date', label: 'Date & time' },
                    { key: 'type', label: 'Type' },
                    { key: 'batch', label: 'Batch' },
                    { key: 'status', label: 'Status' },
                    { key: 'processed', label: 'Processed' },
                    { key: 'actions', label: 'Actions', align: 'right' },
                ]}
                empty={filteredHistory.length === 0 && (
                    <Empty>
                        {filter === 'All' ? 'No bulk jobs have run yet.' : `No ${filter.toLowerCase()} jobs yet.`}
                    </Empty>
                )}
            >
                {filteredHistory.map((job) => (
                    <Tr key={job.id}>
                        <Td muted nowrap>{job.date}</Td>
                        <Td nowrap>{job.type}</Td>
                        <Td>{job.batch_name}</Td>
                        <Td><Status tone={job.status === 'Completed' ? 'up' : 'down'}>{job.status}</Status></Td>
                        <Td nowrap>
                            {job.processed} succeeded
                            {job.failed > 0 && <Muted> · {job.failed} failed</Muted>}
                        </Td>
                        <Td align="right" nowrap>
                            <div style={{ display: 'inline-flex', gap: 6 }}>
                                {job.type !== 'Team Import' && (
                                    <Btn size="sm" aria-label={`Download ZIP for ${job.batch_name}`}>
                                        <Download aria-hidden="true" size={12} strokeWidth={1.8} /> ZIP
                                    </Btn>
                                )}
                                <Btn size="sm" aria-label={`View log for ${job.batch_name}`}>
                                    <Archive aria-hidden="true" size={12} strokeWidth={1.8} /> Log
                                </Btn>
                                {job.failed > 0 && (
                                    <Btn size="sm" aria-label={`Retry failed rows in ${job.batch_name}`}>
                                        <RefreshCw aria-hidden="true" size={12} strokeWidth={1.8} /> Retry failed
                                    </Btn>
                                )}
                            </div>
                        </Td>
                    </Tr>
                ))}
            </Table>
        </Page>
    );
}
