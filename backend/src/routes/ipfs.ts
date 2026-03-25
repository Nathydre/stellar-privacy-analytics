import express, { Request, Response } from 'express';
import ipfsService from '../services/ipfsService';
import { body, param, validationResult } from 'express-validator';
import { logger } from '../utils/logger';

const router = express.Router();

/**
 * POST /api/ipfs/upload
 * Upload and pin a file to IPFS
 */
router.post('/upload', [
  body('fileName').notEmpty().withMessage('File name is required'),
  body('encrypted').optional().isBoolean(),
  body('version').optional().isInt({ min: 0 }),
  body('uploader').optional().isString(),
  body('decryptionKeyHash').optional().isString()
], async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const { fileName, encrypted, version, uploader, decryptionKeyHash } = req.body;
    
    const result = await ipfsService.uploadAndPinFile(req.file.buffer, fileName, {
      encrypted: encrypted || false,
      version: version ? parseInt(version) : 1,
      uploader,
      decryptionKeyHash
    });

    res.json({
      success: true,
      cid: result.cid,
      size: result.size,
      gatewayUrl: ipfsService.getGatewayUrl(result.cid)
    });
  } catch (error) {
    logger.error('Error in IPFS upload:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

/**
 * POST /api/ipfs/pin/:cid
 * Pin an existing CID to Pinata
 */
router.post('/pin/:cid', [
  param('cid').notEmpty().withMessage('CID is required')
], async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { cid } = req.params;
    const { fileName } = req.body;

    const result = await ipfsService.pinToPinata(cid, fileName);

    res.json({
      success: true,
      pinData: result,
      gatewayUrl: ipfsService.getGatewayUrl(cid)
    });
  } catch (error) {
    logger.error('Error pinning CID:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

/**
 * GET /api/ipfs/availability/:cid
 * Check data availability for a CID
 */
router.get('/availability/:cid', [
  param('cid').notEmpty().withMessage('CID is required')
], async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { cid } = req.params;

    const availabilityRecord = await ipfsService.createDataAvailabilityRecord(cid);
    const pinInfo = await ipfsService.getPinInfo(cid);
    const filecoinDeals = await ipfsService.getFilecoinDeals(cid);

    res.json({
      success: true,
      availability: availabilityRecord,
      pinInfo,
      filecoinDeals,
      gatewayUrl: ipfsService.getGatewayUrl(cid)
    });
  } catch (error) {
    logger.error('Error checking availability:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

/**
 * GET /api/ipfs/retrieve/:cid
 * Retrieve file from IPFS
 */
router.get('/retrieve/:cid', [
  param('cid').notEmpty().withMessage('CID is required')
], async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { cid } = req.params;

    // Check availability first
    const isAvailable = await ipfsService.checkAvailability(cid);
    if (!isAvailable) {
      return res.status(404).json({ error: 'CID not available on IPFS' });
    }

    const fileBuffer = await ipfsService.retrieveFile(cid);

    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${cid}"`
    });

    res.send(fileBuffer);
  } catch (error) {
    logger.error('Error retrieving file:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

/**
 * POST /api/ipfs/batch-pin
 * Pin multiple CIDs at once
 */
router.post('/batch-pin', [
  body('cids').isArray({ min: 1 }).withMessage('CIDs array is required'),
  body('cids.*').notEmpty().withMessage('Each CID must be non-empty')
], async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { cids } = req.body;

    const results = await ipfsService.batchPin(cids);

    res.json({
      success: true,
      pinnedCount: results.length,
      results: results.map(result => ({
        cid: result.ipfsHash,
        size: result.pinSize,
        timestamp: result.timestamp
      }))
    });
  } catch (error) {
    logger.error('Error in batch pinning:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

/**
 * DELETE /api/ipfs/unpin/:cid
 * Unpin a CID from Pinata
 */
router.delete('/unpin/:cid', [
  param('cid').notEmpty().withMessage('CID is required')
], async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { cid } = req.params;

    await ipfsService.unpinFromPinata(cid);

    res.json({
      success: true,
      message: `CID ${cid} unpinned successfully`
    });
  } catch (error) {
    logger.error('Error unpinning CID:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

/**
 * GET /api/ipfs/deals/:cid
 * Get Filecoin deals for a CID
 */
router.get('/deals/:cid', [
  param('cid').notEmpty().withMessage('CID is required')
], async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { cid } = req.params;

    const deals = await ipfsService.getFilecoinDeals(cid);

    res.json({
      success: true,
      cid,
      deals,
      dealCount: deals.length
    });
  } catch (error) {
    logger.error('Error getting Filecoin deals:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

/**
 * POST /api/ipfs/verify-key
 * Verify decryption key against stored hash
 */
router.post('/verify-key', [
  body('decryptionKey').notEmpty().withMessage('Decryption key is required'),
  body('keyHash').notEmpty().withMessage('Key hash is required')
], async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { decryptionKey, keyHash } = req.body;

    const isValid = ipfsService.verifyDecryptionKey(decryptionKey, keyHash);

    res.json({
      success: true,
      valid: isValid
    });
  } catch (error) {
    logger.error('Error verifying decryption key:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

/**
 * GET /api/ipfs/gateway/:cid
 * Get gateway URL for a CID
 */
router.get('/gateway/:cid', [
  param('cid').notEmpty().withMessage('CID is required')
], async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { cid } = req.params;

    const gatewayUrl = ipfsService.getGatewayUrl(cid);

    res.json({
      success: true,
      cid,
      gatewayUrl
    });
  } catch (error) {
    logger.error('Error getting gateway URL:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

export default router;
