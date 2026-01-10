import HomeIcon from './icons/HomeIcon.svelte';
import StatusIcon from './icons/StatusIcon.svelte';
import GlobeIcon from './icons/MapIcon.svelte';
import CreditsIcon from './icons/CreditsIcon.svelte';
import ArchivesIcon from './icons/ArchivesIcon.svelte';
import SettingsIcon from './icons/SettingsIcon.svelte';
import DatabaseIcon from './icons/DatabaseIcon.svelte';
import DocumentationIcon from './icons/DocumentationIcon.svelte';
import RolesIcon from './icons/RolesIcon.svelte';
import OffersIcon from './icons/OffersIcon.svelte';
import DashboardIcon from './icons/DashboardIcon.svelte';
import ShoppingIcon from './icons/ShoppingIcon.svelte';
import ChecklistIcon from './icons/ChecklistIcon.svelte';
import LibraryIcon from './icons/LibraryIcon.svelte';
import ExpensesIcon from './icons/ExpensesIcon.svelte';
import FederationIcon from './icons/FederationIcon.svelte';
import MyHolonsIcon from './icons/MyHolonsIcon.svelte';
import OrbitsIcon from './icons/OrbitsIcon.svelte';
import FlowIcon from './icons/FlowIcon.svelte';

export const data = [
	{
		title: 'Dashboard',
		icon: DashboardIcon,
		link: '/dashboard'
	},
	{
		title: 'Tasks',
		icon: ArchivesIcon,
		link: '/tasks'
	},
	{
		title: 'Schedule',
		icon: CreditsIcon,
		link: '/calendar'
	},
	{
		title: 'Expenses',
		icon: ExpensesIcon,
		link: '/expenses'
	},
	{
		title: 'Roles',
		icon: RolesIcon,
		link: '/roles'
	},
	{
		title: 'Map',
		icon: GlobeIcon,
		link: '/map'
	},
	{
		title: 'Offers & Requests',
		icon: OffersIcon,
		link: '/offers'
	},
	{
		title: 'Shopping List',
		icon: ShoppingIcon,
		link: '/shopping'
	},
	{
		title: 'Checklists',
		icon: ChecklistIcon,
		link: '/checklists'
	},
	{
		title: 'Library',
		icon: LibraryIcon,
		link: '/library'
	},
	{
		title: 'Status',
		icon: StatusIcon,
		link: '/status'
	},
	{
		title: 'Federation',
		icon: FederationIcon,
		link: '/federation',
		useHomeHolon: true // Always use the logged-in user's home holon
	},
	{
		title: 'Flow',
		icon: FlowIcon,
		link: '/flow',
		useHomeHolon: true // Always use the logged-in user's home holon
	},
	{
		title: 'Settings',
		icon: SettingsIcon,
		link: '/settings',
		useHomeHolon: true // Always use the logged-in user's home holon
	},
	{
		title: 'Database',
		icon: DatabaseIcon,
		link: '/db'
	}
	// {
	// 	title: 'Documentation',
	// 	icon: DocumentationIcon,
	// 	link: '/admin/documentation'
	// }
];
