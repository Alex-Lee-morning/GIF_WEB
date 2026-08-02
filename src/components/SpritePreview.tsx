import type { PetSpriteSet } from '../../shared/types'

interface SpritePreviewProps {
  sprites: PetSpriteSet
  cutoutDataUrl: string
  cartoonDataUrl: string
  usedFaceCrop: boolean
  swapWalkDirection?: boolean
  onConfirm: () => void
  onCancel: () => void
  onSwapWalkDirection?: () => void
  onDownloadGif?: () => void
}

export function SpritePreview({
  sprites,
  cutoutDataUrl,
  cartoonDataUrl,
  usedFaceCrop,
  swapWalkDirection = false,
  onConfirm,
  onCancel,
  onSwapWalkDirection,
  onDownloadGif,
}: SpritePreviewProps) {
  return (
    <div className="preview-confirm">
      <h3>预览卡通动画</h3>
      <p className="hint">
        {usedFaceCrop
          ? '仅脸部模式：已卡通化；拖动为「手拉脸」四向形变，待机为小球砸头后皱眉。'
          : '已卡通化并生成动画帧。全身可选择保留原图姿势，或不保留则生成全新侧面卡通形象再左右走 / 眨眼。若走路方向与动画反了，点「对调左右走动画」。'}
        {!usedFaceCrop && swapWalkDirection ? '（当前已对调）' : ''}
      </p>
      <div className="preview-confirm-grid">
        <figure>
          <img src={cutoutDataUrl} alt="抠图主体" className="cutout-thumb" />
          <figcaption>抠图主体</figcaption>
        </figure>
        <figure>
          <img src={cartoonDataUrl} alt="卡通化" className="cutout-thumb" />
          <figcaption>卡通化</figcaption>
        </figure>
        <figure>
          <img src={sprites.previewGifDataUrl} alt="动画预览" className="preview-gif" />
          <figcaption>动画预览</figcaption>
        </figure>
      </div>
      <div className="preview-actions">
        {onSwapWalkDirection && !usedFaceCrop ? (
          <button type="button" className="btn secondary" onClick={onSwapWalkDirection}>
            {swapWalkDirection ? '还原左右走动画' : '对调左右走动画'}
          </button>
        ) : null}
        <button type="button" className="btn primary" onClick={onConfirm}>
          确认为桌宠
        </button>
        <button type="button" className="btn secondary" onClick={onCancel}>
          取消
        </button>
        {onDownloadGif ? (
          <button type="button" className="btn secondary" onClick={onDownloadGif}>
            下载预览 GIF
          </button>
        ) : null}
      </div>
    </div>
  )
}
