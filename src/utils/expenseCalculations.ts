interface Expense {
    id: string;
    amount: number;
    currency: string;
    description: string;
    paidBy: string;
    splitWith: string[];
    date: string;
}

interface User {
    id: number;
    first_name: string;
}

export function calculateCurrencyBalance(
    userId: string | number, 
    currency: string, 
    expenses: Record<string, Expense>, 
    users: User[]
): number {
    if (!currency || !userId || users.length === 0) return 0;
    
    // Normalize currency exactly like Expenses.svelte does
    const normalizedCurrency = currency.toLowerCase().replace(/s$/, '').replace(/[^a-z]/g, '');
    
    // Find the user index - match exactly how Expenses.svelte does it
    const userIndex = users.findIndex(user => user.id === parseInt(userId.toString()));
    if (userIndex === -1) return 0;
    
    // Create credit matrix using the exact same logic as Expenses.svelte
    const creditMatrix = Array(users.length).fill(0).map(() => Array(users.length).fill(0));
    
    Object.values(expenses).forEach(expense => {
        // Add null check for expense.currency before calling toLowerCase()
        if (expense && expense.currency && expense.currency.toLowerCase() === normalizedCurrency) {
            const splitWithList = Array.isArray(expense.splitWith) ? expense.splitWith : [];
            const amountPerPerson = expense.amount / (splitWithList.length || 1);
            const payerIndex = users.findIndex(user => user.id === parseInt(expense.paidBy));
            
            if (payerIndex === -1) return; // Skip if payer not found
            
            splitWithList.forEach(memberId => {
                const memberIndex = users.findIndex(user => user.id === parseInt(memberId));
                if (memberIndex === -1) return; // Skip if member not found
                
                if (payerIndex !== memberIndex) {
                    // Different people: payer is owed, member owes
                    creditMatrix[payerIndex][memberIndex] += amountPerPerson;
                    creditMatrix[memberIndex][payerIndex] -= amountPerPerson;
                }
                // If payerIndex === memberIndex, they paid for themselves, so no credit/debt
            });
        }
    });
    
    // Calculate balance by summing the user's row in the credit matrix
    return creditMatrix[userIndex].reduce((sum, val) => sum + val, 0);
}

export function calculateCreditMatrix(
    currency: string, 
    expenses: Record<string, Expense>, 
    users: User[]
): number[][] {
    if (!currency || users.length === 0) return [];
    
    const normalizedCurrency = currency.toLowerCase().replace(/s$/, '').replace(/[^a-z]/g, '');
    const creditMatrix = Array(users.length).fill(0).map(() => Array(users.length).fill(0));
    
    Object.values(expenses).forEach(expense => {
        if (expense && expense.currency && expense.currency.toLowerCase() === normalizedCurrency) {
            const splitWithList = Array.isArray(expense.splitWith) ? expense.splitWith : [];
            const amountPerPerson = expense.amount / (splitWithList.length || 1);
            const payerIndex = users.findIndex(user => user.id === parseInt(expense.paidBy));
            
            if (payerIndex === -1) return;
            
            splitWithList.forEach(memberId => {
                const memberIndex = users.findIndex(user => user.id === parseInt(memberId));
                if (memberIndex === -1) return;
                
                if (payerIndex !== memberIndex) {
                    creditMatrix[payerIndex][memberIndex] += amountPerPerson;
                    creditMatrix[memberIndex][payerIndex] -= amountPerPerson;
                }
            });
        }
    });
    
    return creditMatrix;
} 