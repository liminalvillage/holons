interface Expense {
    id: string;
    amount: number;
    currency?: string;
    /** Legacy field used by time-tracking ("hour"). Treated as currency when set. */
    unit?: string;
    description: string;
    paidBy: string;
    splitWith: string[];
    date: string;
}

interface User {
    id: number | string;
    first_name: string;
}

export function normalizeCurrency(c: string): string {
    return (c || '').toLowerCase().replace(/s$/, '').replace(/[^a-z]/g, '');
}

/**
 * Returns the canonical currency code for an expense, preferring the
 * `currency` field and falling back to the legacy `unit` field used by
 * time-tracking entries (currency: 'hour').
 */
export function expenseCurrency(e: Expense): string {
    return normalizeCurrency((e?.currency || e?.unit || '') as string);
}

export function calculateCurrencyBalance(
    userId: string | number,
    currency: string,
    expenses: Record<string, Expense>,
    users: User[]
): number {
    if (!currency || !userId || users.length === 0) return 0;

    const normalizedCurrency = normalizeCurrency(currency);

    const userIndex = users.findIndex(user => String(user.id) === String(userId));
    if (userIndex === -1) return 0;

    const creditMatrix = Array(users.length).fill(0).map(() => Array(users.length).fill(0));

    Object.values(expenses).forEach(expense => {
        if (!expense) return;
        if (expenseCurrency(expense) !== normalizedCurrency) return;
        const splitWithList = Array.isArray(expense.splitWith) ? expense.splitWith : [];
        const amountPerPerson = expense.amount / (splitWithList.length || 1);
        const payerIndex = users.findIndex(user => String(user.id) === String(expense.paidBy));

        if (payerIndex === -1) return;

        splitWithList.forEach(memberId => {
            const memberIndex = users.findIndex(user => String(user.id) === String(memberId));
            if (memberIndex === -1) return;

            if (payerIndex !== memberIndex) {
                creditMatrix[payerIndex][memberIndex] += amountPerPerson;
                creditMatrix[memberIndex][payerIndex] -= amountPerPerson;
            }
        });
    });

    return creditMatrix[userIndex].reduce((sum, val) => sum + val, 0);
}

export function calculateCreditMatrix(
    currency: string,
    expenses: Record<string, Expense>,
    users: User[]
): number[][] {
    if (!currency || users.length === 0) return [];

    const normalizedCurrency = normalizeCurrency(currency);
    const creditMatrix = Array(users.length).fill(0).map(() => Array(users.length).fill(0));

    Object.values(expenses).forEach(expense => {
        if (!expense) return;
        if (expenseCurrency(expense) !== normalizedCurrency) return;
        const splitWithList = Array.isArray(expense.splitWith) ? expense.splitWith : [];
        const amountPerPerson = expense.amount / (splitWithList.length || 1);
        const payerIndex = users.findIndex(user => String(user.id) === String(expense.paidBy));

        if (payerIndex === -1) return;

        splitWithList.forEach(memberId => {
            const memberIndex = users.findIndex(user => String(user.id) === String(memberId));
            if (memberIndex === -1) return;

            if (payerIndex !== memberIndex) {
                creditMatrix[payerIndex][memberIndex] += amountPerPerson;
                creditMatrix[memberIndex][payerIndex] -= amountPerPerson;
            }
        });
    });

    return creditMatrix;
}
