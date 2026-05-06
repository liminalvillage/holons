	// Format time for display
	/**
	 * @param {string | number | Date} dateTime
	 */
        export function formatTime(dateTime ) {
            return new Date(dateTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
	/**
	 * @param {string | number | Date} dateTime
	 */
	export function formatDate(dateTime) {
		const date = new Date(dateTime);
		const today = new Date();
		const tomorrow = new Date(today);
		tomorrow.setDate(tomorrow.getDate() + 1);

		if (date.toDateString() === today.toDateString()) {
			return 'today';
		} else if (date.toDateString() === tomorrow.toDateString()) {
			return 'tomorrow';
		} else {
			const diff = Math.ceil((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
			return `in ${diff} days`;
		}
	}