/**
 * Federation Handshake Helper
 *
 * Provides typed wrappers around the holosphere federation handshake methods.
 * Uses the handshake module exported from holosphere.
 */

import type { HoloSphere } from 'holosphere';
import { handshake } from 'holosphere';

interface LensConfig {
  inbound: string[];
  outbound: string[];
}

interface InitiateParams {
  partnerPubKey: string;
  holonId: string;
  holonName: string;
  lensConfig?: LensConfig;
  message?: string;
}

interface InitiateResult {
  success: boolean;
  requestId?: string;
  error?: string;
}

interface AcceptParams {
  request: {
    requestId: string;
    senderHolonId: string;
    senderHolonName: string;
    capabilities?: any[];
  };
  senderPubKey: string;
  holonId: string;
  holonName: string;
  lensConfig?: LensConfig;
  message?: string;
}

interface AcceptResult {
  success: boolean;
  requestId?: string;
  error?: string;
}

interface RejectParams {
  requestId: string;
  senderPubKey: string;
  message?: string;
}

interface RejectResult {
  success: boolean;
  error?: string;
}

/**
 * Create federation handshake helpers bound to a HoloSphere instance
 */
export function useFederationHandshake(holosphere: HoloSphere | null | undefined) {
  /**
   * Initiate a federation handshake with another holon
   * Sends a DM request to the partner - does NOT immediately federate
   */
  async function initiateFederationHandshake(
    privateKey: string,
    params: InitiateParams
  ): Promise<InitiateResult> {
    if (!holosphere) {
      return { success: false, error: 'HoloSphere not available' };
    }

    try {
      // Use the handshake module's initiateFederationHandshake function
      // This sends a DM request and does NOT call federateHolon
      const result = await handshake.initiateFederationHandshake(holosphere, privateKey, params);
      return result;
    } catch (error: any) {
      console.error('[useFederationHandshake] initiate error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Accept a federation request
   * This is when we receive a request and want to accept it
   */
  async function acceptFederationRequest(
    privateKey: string,
    params: AcceptParams
  ): Promise<AcceptResult> {
    if (!holosphere) {
      return { success: false, error: 'HoloSphere not available' };
    }

    try {
      // Use the handshake module's acceptFederationRequest function
      // This sends a response DM AND creates the federation
      const result = await handshake.acceptFederationRequest(holosphere, privateKey, params);
      return result;
    } catch (error: any) {
      console.error('[useFederationHandshake] accept error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Reject a federation request
   */
  async function rejectFederationRequest(
    privateKey: string,
    params: RejectParams
  ): Promise<RejectResult> {
    if (!holosphere) {
      return { success: false, error: 'HoloSphere not available' };
    }

    try {
      // Use the handshake module's rejectFederationRequest function
      const result = await handshake.rejectFederationRequest(holosphere, privateKey, params);
      return result;
    } catch (error: any) {
      console.error('[useFederationHandshake] reject error:', error);
      return { success: false, error: error.message };
    }
  }

  return {
    initiateFederationHandshake,
    acceptFederationRequest,
    rejectFederationRequest
  };
}
