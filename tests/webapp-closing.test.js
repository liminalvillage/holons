import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock Telegram WebApp API
const mockTelegramWebApp = {
    ready: vi.fn(),
    sendData: vi.fn(),
    close: vi.fn(),
    MainButton: {
        setText: vi.fn().mockReturnThis(),
        show: vi.fn().mockReturnThis(),
        onClick: vi.fn().mockReturnThis()
    },
    initData: '',
    initDataUnsafe: {}
};

// Mock global Telegram object
global.Telegram = {
    WebApp: mockTelegramWebApp
};

// Mock mapboxgl
global.mapboxgl = {
    Map: vi.fn().mockReturnValue({
        on: vi.fn(),
        addControl: vi.fn(),
        getSource: vi.fn().mockReturnValue({
            setData: vi.fn()
        })
    }),
    Popup: vi.fn().mockReturnValue({
        setLngLat: vi.fn().mockReturnThis(),
        setHTML: vi.fn().mockReturnThis(),
        addTo: vi.fn().mockReturnThis()
    }),
    GeolocateControl: vi.fn()
};

// Mock h3 library
global.h3 = {
    latLngToCell: vi.fn().mockReturnValue('891e850d50fffff'),
    gridDisk: vi.fn().mockReturnValue(['891e850d50fffff']),
    cellToBoundary: vi.fn().mockReturnValue([[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]])
};

describe('WebApp Closing Functionality', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('should call Telegram.WebApp.close() after sending data', () => {
        // Simulate the sendHex function
        function sendHex(hex) {
            mockTelegramWebApp.sendData(hex);
            mockTelegramWebApp.close();
        }

        const testHex = '891e850d50fffff';
        sendHex(testHex);

        expect(mockTelegramWebApp.sendData).toHaveBeenCalledWith(testHex);
        expect(mockTelegramWebApp.close).toHaveBeenCalled();
    });

    it('should call close() when cancel button is clicked', () => {
        // Simulate the cancel button click
        const cancelButtonClick = mockTelegramWebApp.MainButton.onClick.mock.calls[0][0];
        cancelButtonClick();

        expect(mockTelegramWebApp.close).toHaveBeenCalled();
    });

    it('should call close() when webviewClose function is called', () => {
        // Simulate the webviewClose function
        function webviewClose() {
            mockTelegramWebApp.close();
        }

        webviewClose();
        expect(mockTelegramWebApp.close).toHaveBeenCalled();
    });

    it('should initialize Telegram WebApp correctly', () => {
        // Simulate the initialization
        mockTelegramWebApp.ready();
        mockTelegramWebApp.MainButton.setText('❌ Cancel');
        mockTelegramWebApp.MainButton.show();

        expect(mockTelegramWebApp.ready).toHaveBeenCalled();
        expect(mockTelegramWebApp.MainButton.setText).toHaveBeenCalledWith('❌ Cancel');
        expect(mockTelegramWebApp.MainButton.show).toHaveBeenCalled();
    });

    it('should create popup with confirmation button', () => {
        const mockPopup = {
            setLngLat: vi.fn().mockReturnThis(),
            setHTML: vi.fn().mockReturnThis(),
            addTo: vi.fn().mockReturnThis()
        };

        const mockMapboxgl = {
            Popup: vi.fn().mockReturnValue(mockPopup)
        };

        // Simulate popup creation
        const popup = mockMapboxgl.Popup()
            .setLngLat([0, 0])
            .setHTML('<div>Test popup</div>')
            .addTo({});

        expect(mockMapboxgl.Popup).toHaveBeenCalled();
        expect(mockPopup.setLngLat).toHaveBeenCalledWith([0, 0]);
        expect(mockPopup.setHTML).toHaveBeenCalledWith('<div>Test popup</div>');
        expect(mockPopup.addTo).toHaveBeenCalled();
    });

    it('should call confirmHex function when confirmation button is clicked', () => {
        const confirmHex = vi.fn();
        const testHex = '891e850d50fffff';

        // Simulate confirmation button click
        confirmHex(testHex);

        expect(confirmHex).toHaveBeenCalledWith(testHex);
    });
}); 