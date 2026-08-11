import { defineConfig } from '@adonisjs/core/bodyparser'
import { MAX_NAS_UPLOAD_BYTES } from '#modules/coffre/services/nas_upload_limits'

const bodyParserConfig = defineConfig({
  /**
   * The bodyparser middleware will parse the request body
   * for the following HTTP methods.
   */
  allowedMethods: ['POST', 'PUT', 'PATCH', 'DELETE'],

  /**
   * Config for the "application/x-www-form-urlencoded"
   * content-type parser
   */
  form: {
    convertEmptyStringsToNull: true,
    types: ['application/x-www-form-urlencoded'],
  },

  /**
   * Config for the JSON parser
   */
  json: {
    convertEmptyStringsToNull: true,
    types: [
      'application/json',
      'application/json-patch+json',
      'application/vnd.api+json',
      'application/csp-report',
    ],
  },

  /**
   * Config for the "multipart/form-data" content-type parser.
   * File uploads are handled by the multipart parser.
   */
  multipart: {
    /**
     * Enabling auto process allows bodyparser middleware to
     * move all uploaded files inside the tmp folder of your
     * operating system
     */
    autoProcess: true,
    convertEmptyStringsToNull: true,
    processManually: [],

    /**
     * Maximum limit of data to parse including all files
     * and fields
     *
     * ⚠️ Relevé pour l'envoi de fichiers NAS du coffre (CC-240, `MAX_NAS_UPLOAD_BYTES`) — vidéos
     * personnelles comprises. C'est le plafond GLOBAL de la requête ; les routes existantes
     * (`backupImportValidator` 20mb, `documentExtractValidator` 15mb côté Leitner) gardent leur
     * propre garde `vine.file({ size })`, plus stricte, qui reste la vraie limite par route.
     */
    limit: MAX_NAS_UPLOAD_BYTES,
    types: ['multipart/form-data'],
  },
})

export default bodyParserConfig
