export interface Quest {
    id?: string;
    title: string;
    when: string;
    ends?: string;
    status: 'ongoing' | 'completed' | 'cancelled' | 'scheduled' | string;
    location?: string;
    participants: Array<{
        username: string;
        [key: string]: any;
    }>;
    _deleted?: boolean;
    [key: string]: any;
} 