const { Router } = require('express');
const multer = require('multer');
const requireAuth = require('../middlewares/auth.middleware');
const { uploadFile, MAX_VIDEO_BYTES } = require('../controllers/upload.controller');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_VIDEO_BYTES } });
const router = Router();

router.use(requireAuth);
router.post('/', upload.single('file'), uploadFile);

module.exports = router;
